"""Case workspace (ai-dvokat): verified chat folder in metadata and the per-turn builtin switch.

Run: python3 -m unittest discover -s tests/custom -p 'test_*.py' (no backend dependencies: the helper module is loaded by
path, the call sites are checked in the source). The live path — X-Ai-Folder-Id from the second turn, a colleague in a
shared folder, knowledge and notes switched off — is checked on the image by ~/ai-dvokat/tools/tests/case_probe/run.sh.
"""
import asyncio
import importlib.util
import re
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("custom_case", ROOT / "backend/open_webui/custom/case.py")
case = importlib.util.module_from_spec(spec)
spec.loader.exec_module(case)

OWNER = SimpleNamespace(id="u-owner", role="user")
COLLEAGUE = SimpleNamespace(id="u-colleague", role="user")
STRANGER = SimpleNamespace(id="u-stranger", role="user")
ADMIN = SimpleNamespace(id="u-admin", role="admin")


class World:
    """Folders and read access as upstream: owner and grantees read, others do not (has_folder_access)."""

    def __init__(self):
        self.folders = {"f-case": SimpleNamespace(id="f-case", user_id="u-owner"),
                        "f-other": SimpleNamespace(id="f-other", user_id="u-owner")}
        self.readers = {"f-case": {"u-owner", "u-colleague"}, "f-other": {"u-owner"}}
        self.lookups = []

    async def get_folder(self, folder_id):
        self.lookups.append(folder_id)
        return self.folders.get(folder_id)

    def can_read(self, user):
        async def check(folder):
            return user.id in self.readers.get(folder.id, set())
        return check


def resolve(world, user, chat_folder, client_folder, checked=None, saved=True):
    chat = SimpleNamespace(folder_id=chat_folder) if saved else None
    return asyncio.run(case.verified_chat_folder_id(user, chat, client_folder, checked, world.get_folder,
                                                    world.can_read(user)))


class VerifiedFolderTest(unittest.TestCase):
    def test_old_chat_in_folder_has_folder_from_second_turn(self):
        """The browser sends folder_id only with the first message; later turns rely on the saved chat."""
        w = World()
        checked = w.folders["f-case"]  # upstream found and read-checked the author's folder
        self.assertEqual(resolve(w, OWNER, "f-case", None, checked), "f-case")
        self.assertEqual(w.lookups, [], "the folder upstream already checked is reused, no second query")

    def test_colleague_in_shared_folder_chat_gets_the_folder(self):
        """share_mode=continue: upstream's author filter gives the colleague no folder (checked=None)."""
        w = World()
        self.assertEqual(resolve(w, COLLEAGUE, "f-case", None, checked=None), "f-case")

    def test_no_read_access_means_none(self):
        w = World()
        self.assertIsNone(resolve(w, STRANGER, "f-case", None))
        self.assertIsNone(resolve(w, STRANGER, None, "f-case", saved=False), "client-sent folder is checked too")

    def test_chat_outside_folder_is_none(self):
        w = World()
        self.assertIsNone(resolve(w, OWNER, None, None))
        self.assertEqual(w.lookups, [])

    def test_temporary_chat_and_deep_subagent_use_the_client_folder(self):
        w = World()
        self.assertEqual(resolve(w, OWNER, None, "f-case", saved=False), "f-case", "temporary chat")
        # Deep sub-agent: the child chat is saved without a folder, the parent folder comes in the request
        self.assertEqual(resolve(w, COLLEAGUE, None, "f-case"), "f-case")

    def test_saved_chat_folder_wins_over_client_folder(self):
        w = World()
        self.assertEqual(resolve(w, OWNER, "f-case", "f-other"), "f-case")

    def test_admin_and_missing_folder_and_no_user(self):
        w = World()
        self.assertEqual(resolve(w, ADMIN, "f-other", None), "f-other", "admins pass, like upstream")
        self.assertIsNone(resolve(w, OWNER, "f-gone", None), "deleted folder")
        self.assertIsNone(asyncio.run(case.verified_chat_folder_id(None, None, "f-case", None, w.get_folder,
                                                                   w.can_read(OWNER))))


class BuiltinOffTest(unittest.TestCase):
    def test_values(self):
        self.assertEqual(case.builtin_tools_off({"builtin_tools_off": ["knowledge", "notes"]}),
                         frozenset({"knowledge", "notes"}))
        for meta in ({}, None, {"builtin_tools_off": None}, {"builtin_tools_off": "knowledge"},
                     {"builtin_tools_off": {"knowledge": True}}):
            self.assertEqual(case.builtin_tools_off(meta), frozenset(), meta)
        self.assertEqual(case.builtin_tools_off({"builtin_tools_off": ["notes", 1, None]}), frozenset({"notes"}))


class CallSitesTest(unittest.TestCase):
    """The upstream touch points stay where the helpers need them (rebase guard; CUSTOM.md, «Точки подключения»)."""

    def read(self, rel):
        return (ROOT / "backend/open_webui" / rel).read_text(encoding="utf-8")

    def test_middleware_sets_verified_folder_before_inlet_and_tools(self):
        src = self.read("utils/middleware.py")
        start = src.index("async def process_chat_payload(")
        knowledge = src.index("metadata['folder_knowledge'] = await get_owner_accessible_folder_files(folder)", start)
        hook = src.index("metadata['folder_id'] = await verified_chat_folder_id(", start)
        inlet = src.index("filter_type='inlet'", start)
        mcp = src.index("mcp_clients", inlet)
        self.assertTrue(knowledge < hook < inlet < mcp, "after the folder prompt, before inlet filters and MCP headers")
        # the folder system prompt and knowledge keep upstream's author filter
        self.assertIn("folder_id = await Chats.get_chat_folder_id(chat_id, user.id)", src[start:hook])
        self.assertRegex(src[start:hook], r"folder = None  # ai-dvokat")

    def test_attached_knowledge_respects_the_switch(self):
        src = self.read("utils/middleware.py")
        self.assertIn("if model_builtin_tools.get('knowledge', True) and 'knowledge' not in builtin_tools_off(metadata):", src)

    def test_builtin_category_helper_respects_the_switch(self):
        src = self.read("utils/tools.py")
        body = src[src.index("def is_builtin_tool_enabled("):]
        body = body[:body.index("return builtin_tools.get(category, default)")]
        self.assertIn("builtin_tools_off(extra_params.get('__metadata__'))", body)

    def test_folder_id_header_template(self):
        src = self.read("utils/headers.py")
        self.assertTrue(re.search(r"'\{\{FOLDER_ID\}\}': metadata\.get\('folder_id', ''\) or ''", src))


if __name__ == '__main__':
    unittest.main()
