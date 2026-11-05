"""Exercise the actual surgical deploy merger against preserved local routes."""
import contextlib
import io
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).parents[1]
SCRIPT = SCRIPTS / 'hst-orange-backend.sh'


class RouteMergeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=SCRIPTS)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.old, self.stage, self.dest = [self.root/name for name in ('old.js','stage.js','dest.js')]
        script = SCRIPT.read_text()
        self.code = re.search(r"python3 - [^\n]*routes/index\.js[^\n]* <<'PY'\n(.*?)\nPY", script, re.S).group(1)
        head = "import {getHstProposals} from '../controllers/aiHstController.js';\napiRouter.use(requireAuth);\n"
        self.base = head + "apiRouter.get('/unified-ai/hst/proposals',requireOperator,getHstProposals);\napiRouter.post('/unified-ai/hst/approvals',requireOperator,requireCsrf,postHstApproval);\napiRouter.get('/private-local',localHandler);\napiRouter.get('/bootstrap',bootstrap);\n"
        self.old.write_text(self.base)
        routes = [f"apiRouter.get('/unified-ai/hst/fixture-{n}',requireOperator,fixture);" for n in range(8)]
        routes += ["apiRouter.post('/unified-ai/hst/dose-volume/plans',requireOperator,requireCsrf,postDoseVolumePlan);",
                   "apiRouter.post('/unified-ai/hst/dose-volume/approvals',requireOperator,requireCsrf,postDoseVolumeApproval);",
                   "apiRouter.post('/unified-ai/hst/dose-volume/sessions/:id/reconcile',requireAdmin,requireCsrf,postDoseVolumeReconcile);"]
        self.stage.write_text(head + '\n'.join(routes) + '\n')

    def merge(self):
        with patch.object(sys,'argv',['merge',str(self.old),str(self.stage),str(self.dest)]),contextlib.redirect_stdout(io.StringIO()):
            exec(compile(self.code,'deployment router merger','exec'),{})
        return self.dest.read_text()

    def test_new_routes_preserve_local_route_and_auth_boundary_and_are_idempotent(self):
        first = self.merge()
        self.assertIn("apiRouter.get('/private-local',localHandler)",first)
        self.assertIn('requireOperator,requireCsrf,postDoseVolumeApproval',first)
        self.assertIn('requireAdmin,requireCsrf,postDoseVolumeReconcile',first)
        self.assertLess(first.index('apiRouter.use(requireAuth)'),first.index("apiRouter.post('/unified-ai/hst/dose-volume"))
        self.old.write_text(first)
        second = self.merge()
        self.assertEqual(second.count("apiRouter.post('/unified-ai/hst/dose-volume/plans'"),1)
        self.assertEqual(second.count("from '../controllers/doseVolumeController.js'"),1)

    def test_existing_dashboard_outside_authentication_is_not_silently_preserved(self):
        self.old.write_text("apiRouter.get('/unified-ai/dashboard',getUnifiedAiDashboard);\n"+self.base)
        with self.assertRaisesRegex(SystemExit,'outside authentication'):
            self.merge()


if __name__ == '__main__':
    unittest.main()
