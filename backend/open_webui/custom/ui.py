"""Public UI configuration only; never put credentials in CUSTOM_UI."""
import json
import logging


def load_custom_ui(raw: str) -> dict:
    try:
        value = json.loads(raw)
        if isinstance(value, dict):
            return value
    except (ValueError, TypeError):
        pass
    logging.getLogger(__name__).warning("CUSTOM_UI must be a JSON object; custom features disabled")
    return {}
