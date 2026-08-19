using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

/// <summary>
/// Runs the EditMode tests from a menu item and writes the result to
/// <c>Temp/SlotMachineTestResults.txt</c>.
///
/// The Test Runner window is the normal way to do this. This exists because a headless or remote
/// session cannot open that window, and because the API's callbacks arrive after the call that
/// started the run has returned — so the outcome has to be left somewhere durable rather than
/// returned. It lives in the test assembly, so nothing in the shipping code depends on the test
/// framework.
/// </summary>
public static class SlotMachineTestRunnerMenu
{
    private const string ResultPath = "Temp/SlotMachineTestResults.txt";

    [MenuItem("GameShow/Slot Machine/Run EditMode Tests")]
    public static void Run()
    {
        var api = ScriptableObject.CreateInstance<TestRunnerApi>();
        api.RegisterCallbacks(new Callbacks());
        api.Execute(new ExecutionSettings(new Filter
        {
            testMode = TestMode.EditMode,
            assemblyNames = new[] { "GameShow.SlotMachine.Tests" },
        }));

        Debug.Log("[SlotTests] run started; the result will be written to " + ResultPath);
    }

    private class Callbacks : ICallbacks
    {
        private readonly StringBuilder _failures = new StringBuilder();

        public void RunStarted(ITestAdaptor testsToRun)
        {
            _failures.Clear();
        }

        public void TestStarted(ITestAdaptor test)
        {
        }

        public void TestFinished(ITestResultAdaptor result)
        {
            if (result.Test.IsSuite || result.TestStatus == TestStatus.Passed)
            {
                return;
            }

            _failures.AppendLine(result.TestStatus + "  " + result.Test.FullName);
            if (!string.IsNullOrEmpty(result.Message))
            {
                _failures.AppendLine("    " + result.Message.Replace("\n", "\n    "));
            }
        }

        public void RunFinished(ITestResultAdaptor result)
        {
            var report = new StringBuilder();
            report.AppendLine("status   = " + result.TestStatus);
            report.AppendLine("passed   = " + result.PassCount);
            report.AppendLine("failed   = " + result.FailCount);
            report.AppendLine("skipped  = " + result.SkipCount);
            report.AppendLine("inconcl. = " + result.InconclusiveCount);
            report.AppendLine("seconds  = " + result.Duration.ToString("0.00"));
            if (_failures.Length > 0)
            {
                report.AppendLine();
                report.AppendLine("failures:");
                report.Append(_failures);
            }

            Directory.CreateDirectory(Path.GetDirectoryName(ResultPath));
            File.WriteAllText(ResultPath, report.ToString());
            Debug.Log("[SlotTests]\n" + report);
        }
    }
}
