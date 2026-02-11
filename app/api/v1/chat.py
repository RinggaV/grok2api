"""
Chat Completions API 璺敱
"""

from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.core.auth import verify_api_key
from app.services.grok.chat import ChatService
from app.services.grok.model import ModelService
from app.core.exceptions import ValidationException
from app.services.quota import enforce_daily_quota


router = APIRouter(tags=["Chat"])


VALID_ROLES = ["developer", "system", "user", "assistant"]
USER_CONTENT_TYPES = ["text", "image_url", "input_audio", "file"]


class MessageItem(BaseModel):
    """娑堟伅椤?"""
    role: str
    content: Union[str, List[Dict[str, Any]]]
    
    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v


class VideoConfig(BaseModel):
    """瑙嗛鐢熸垚閰嶇疆"""
    aspect_ratio: Optional[str] = Field("3:2", description="瑙嗛姣斾緥: 3:2, 16:9, 1:1 绛?)
    video_length: Optional[int] = Field(6, description="瑙嗛鏃堕暱(绉?: 5-15")
    resolution: Optional[str] = Field("SD", description="瑙嗛鍒嗚鲸鐜? SD, HD")
    preset: Optional[str] = Field("custom", description="椋庢牸棰勮: fun, normal, spicy")
    
    @field_validator("aspect_ratio")
    @classmethod
    def validate_aspect_ratio(cls, v):
        allowed = ["2:3", "3:2", "1:1", "9:16", "16:9"]
        if v and v not in allowed:
            raise ValidationException(
                message=f"aspect_ratio must be one of {allowed}",
                param="video_config.aspect_ratio",
                code="invalid_aspect_ratio"
            )
        return v
    
    @field_validator("video_length")
    @classmethod
    def validate_video_length(cls, v):
        if v is not None:
            if v < 5 or v > 15:
                raise ValidationException(
                    message="video_length must be between 5 and 15 seconds",
                    param="video_config.video_length",
                    code="invalid_video_length"
                )
        return v

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, v):
        allowed = ["SD", "HD"]
        if v and v not in allowed:
            raise ValidationException(
                message=f"resolution must be one of {allowed}",
                param="video_config.resolution",
                code="invalid_resolution"
            )
        return v
    
    @field_validator("preset")
    @classmethod
    def validate_preset(cls, v):
        # 鍏佽涓虹┖锛岄粯璁?custom
        if not v:
            return "custom"
        allowed = ["fun", "normal", "spicy", "custom"]
        if v not in allowed:
             raise ValidationException(
                message=f"preset must be one of {allowed}",
                param="video_config.preset",
                code="invalid_preset"
             )
        return v


class ChatCompletionRequest(BaseModel):
    """Chat Completions 璇锋眰"""
    model: str = Field(..., description="妯″瀷鍚嶇О")
    messages: List[MessageItem] = Field(..., description="娑堟伅鏁扮粍")
    stream: Optional[bool] = Field(None, description="鏄惁娴佸紡杈撳嚭")
    thinking: Optional[str] = Field(None, description="鎬濊€冩ā寮? enabled/disabled/None")
    
    # 瑙嗛鐢熸垚閰嶇疆
    video_config: Optional[VideoConfig] = Field(None, description="瑙嗛鐢熸垚鍙傛暟")
    
    model_config = {
        "extra": "ignore"
    }


def validate_request(request: ChatCompletionRequest):
    """楠岃瘉璇锋眰鍙傛暟"""
    # 楠岃瘉妯″瀷
    if not ModelService.valid(request.model):
        raise ValidationException(
            message=f"The model `{request.model}` does not exist or you do not have access to it.",
            param="model",
            code="model_not_found"
        )
    
    # 楠岃瘉娑堟伅
    for idx, msg in enumerate(request.messages):
        content = msg.content
        
        # 瀛楃涓插唴瀹?
        if isinstance(content, str):
            if not content.strip():
                raise ValidationException(
                    message="Message content cannot be empty",
                    param=f"messages.{idx}.content",
                    code="empty_content"
                )
        
        # 鍒楄〃鍐呭
        elif isinstance(content, list):
            if not content:
                raise ValidationException(
                    message="Message content cannot be an empty array",
                    param=f"messages.{idx}.content",
                    code="empty_content"
                )

            has_non_text_block = any(
                isinstance(item, dict) and item.get("type") in ("image_url", "input_audio", "file")
                for item in content
            )
            
            for block_idx, block in enumerate(content):
                # 妫€鏌ョ┖瀵硅薄
                if not block:
                    raise ValidationException(
                        message="Content block cannot be empty",
                        param=f"messages.{idx}.content.{block_idx}",
                        code="empty_block"
                    )
                
                # 妫€鏌?type 瀛楁
                if "type" not in block:
                    raise ValidationException(
                        message="Content block must have a 'type' field",
                        param=f"messages.{idx}.content.{block_idx}",
                        code="missing_type"
                    )
                
                block_type = block.get("type")
                
                # 妫€鏌?type 绌哄€?
                if not block_type or not isinstance(block_type, str) or not block_type.strip():
                    raise ValidationException(
                        message="Content block 'type' cannot be empty",
                        param=f"messages.{idx}.content.{block_idx}.type",
                        code="empty_type"
                    )
                
                # 楠岃瘉 type 鏈夋晥鎬?
                if msg.role == "user":
                    if block_type not in USER_CONTENT_TYPES:
                        raise ValidationException(
                            message=f"Invalid content block type: '{block_type}'",
                            param=f"messages.{idx}.content.{block_idx}.type",
                            code="invalid_type"
                        )
                elif block_type != "text":
                    raise ValidationException(
                        message=f"The `{msg.role}` role only supports 'text' type, got '{block_type}'",
                        param=f"messages.{idx}.content.{block_idx}.type",
                        code="invalid_type"
                    )
                
                # 楠岃瘉瀛楁鏄惁瀛樺湪 & 闈炵┖
                if block_type == "text":
                    text = block.get("text", "")
                    if not isinstance(text, str) or not text.strip():
                        if not has_non_text_block:
                            raise ValidationException(
                                message="Text content cannot be empty",
                                param=f"messages.{idx}.content.{block_idx}.text",
                                code="empty_text"
                            )
                elif block_type == "image_url":
                    image_url = block.get("image_url")
                    if not image_url or not (isinstance(image_url, dict) and image_url.get("url")):
                        raise ValidationException(
                            message="image_url must have a 'url' field",
                            param=f"messages.{idx}.content.{block_idx}.image_url",
                            code="missing_url"
                        )


@router.post("/chat/completions")
async def chat_completions(request: ChatCompletionRequest, api_key: Optional[str] = Depends(verify_api_key)):
    """Chat Completions API - 鍏煎 OpenAI"""
    
    # 鍙傛暟楠岃瘉
    validate_request(request)

    # Daily quota (best-effort)
    await enforce_daily_quota(api_key, request.model)
    
    # 妫€娴嬭棰戞ā鍨?
    model_info = ModelService.get(request.model)
    if model_info and model_info.is_video:
        from app.services.grok.media import VideoService
        
        # 鎻愬彇瑙嗛閰嶇疆 (榛樿鍊煎湪 Pydantic 妯″瀷涓鐞?
        v_conf = request.video_config or VideoConfig()
        
        result = await VideoService.completions(
            model=request.model,
            messages=[msg.model_dump() for msg in request.messages],
            stream=request.stream,
            thinking=request.thinking,
            aspect_ratio=v_conf.aspect_ratio,
            video_length=v_conf.video_length,
            resolution=v_conf.resolution,
            preset=v_conf.preset
        )
    else:
        result = await ChatService.completions(
            model=request.model,
            messages=[msg.model_dump() for msg in request.messages],
            stream=request.stream,
            thinking=request.thinking
        )
    
    if isinstance(result, dict):
        return JSONResponse(content=result)
    else:
        return StreamingResponse(
            result,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
        )


__all__ = ["router"]
