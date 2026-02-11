import importlib
import sys
import types


def _load_chat_module():
    fake_chat = types.ModuleType("app.services.grok.chat")
    fake_chat.ChatService = object
    sys.modules["app.services.grok.chat"] = fake_chat

    fake_model = types.ModuleType("app.services.grok.model")

    class _ModelService:
        @staticmethod
        def valid(_model: str) -> bool:
            return True

    fake_model.ModelService = _ModelService
    sys.modules["app.services.grok.model"] = fake_model

    fake_quota = types.ModuleType("app.services.quota")

    async def _enforce_daily_quota(*_args, **_kwargs):
        return None

    fake_quota.enforce_daily_quota = _enforce_daily_quota
    sys.modules["app.services.quota"] = fake_quota

    return importlib.import_module("app.api.v1.chat")


def test_validate_request_allows_image_only_content_list():
    chat_module = _load_chat_module()

    payload = {
        "model": "grok-4-fast",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": " "},
                    {"type": "image_url", "image_url": {"url": "http://example.com/a.jpg"}},
                ],
            }
        ],
    }

    req = chat_module.ChatCompletionRequest.model_validate(payload)
    chat_module.validate_request(req)
