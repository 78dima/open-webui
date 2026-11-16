"""Case workspace (ai-dvokat): the verified folder of a chat for tool servers and pipes, and a per-turn switch of
builtin tool categories. Pure helpers: the call sites in utils/middleware.py and utils/tools.py pass the lookups in.

Why: upstream resolves the chat folder for the folder system prompt and knowledge with the author filter
(`Chats.get_chat_folder_id(chat_id, user.id)`), and never stores the verified folder in `metadata`. MCP headers
(`{{FOLDER_ID}}`) and pipe functions (`__metadata__['folder_id']`) then only see what the browser sent, and the browser
sends the folder once and resets it. A colleague writing in a shared folder chat (share_mode=continue) gets no folder at
all. The folder system prompt and knowledge keep the upstream behaviour (author's folder); only `metadata['folder_id']`
and the headers get the verified folder of the chat itself."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

BUILTIN_TOOLS_OFF = 'builtin_tools_off'


async def verified_chat_folder_id(
    user: Any,
    chat: Any,
    client_folder_id: str | None,
    checked_folder: Any,
    get_folder: Callable[[str], Awaitable[Any]],
    can_read: Callable[[Any], Awaitable[bool]],
) -> str | None:
    """Folder of this chat that the user may read now, else None.

    The candidate is the saved chat's own `folder_id` without the author filter (a colleague in a shared folder chat),
    otherwise the folder sent by the client: temporary chats, Deep sub-agents (their child chat has no folder; the parent
    folder comes in the request) and a saved chat outside folders, exactly as the upstream fallback. `checked_folder` is
    the folder upstream already read-checked for the system prompt (reused when it is the same one, no second query).
    Admins pass, like upstream."""
    if not user:
        return None
    candidate = (getattr(chat, 'folder_id', None) if chat is not None else None) or client_folder_id
    if not candidate:
        return None
    if checked_folder is not None and getattr(checked_folder, 'id', None) == candidate:
        return checked_folder.id
    folder = await get_folder(candidate)
    if folder is None:
        return None
    if getattr(user, 'role', None) == 'admin' or await can_read(folder):
        return folder.id
    return None


def builtin_tools_off(metadata: Any) -> frozenset[str]:
    """Builtin tool categories switched off for this turn (`metadata['builtin_tools_off']`, set by a filter in inlet,
    e.g. knowledge and notes in a case chat). Anything but a list of strings means nothing is switched off."""
    value = metadata.get(BUILTIN_TOOLS_OFF) if isinstance(metadata, dict) else None
    if not isinstance(value, (list, tuple, set, frozenset)):
        return frozenset()
    return frozenset(v for v in value if isinstance(v, str))
