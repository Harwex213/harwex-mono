using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Inspector for the machine, with the buttons that make it testable without a scene of its own.
///
/// The preview buttons are edit-time only where they can be: <c>Preview Idle</c> and the two
/// forced-result previews snap the reels and light the win with no coroutines, so they work with the
/// prefab open and nothing playing. <c>Test Random Spin</c> needs the coroutines, so it is only
/// offered in play mode and says so.
///
/// Nothing here creates an asset and nothing runs on every repaint: the validation walks the strips
/// only when the button is pressed.
/// </summary>
[CustomEditor(typeof(SlotMachineController))]
public class SlotMachineControllerEditor : Editor
{
    private List<string> _problems;
    private bool _validated;

    public override void OnInspectorGUI()
    {
        DrawDefaultInspector();

        var controller = (SlotMachineController)target;

        EditorGUILayout.Space();
        EditorGUILayout.LabelField("State", EditorStyles.boldLabel);
        using (new EditorGUI.DisabledScope(true))
        {
            EditorGUILayout.EnumPopup("Current", controller.State);
            EditorGUILayout.TextField("Last result", controller.LastResult == null ? "<none>" : controller.LastResult.ToString());
        }

        EditorGUILayout.Space();
        EditorGUILayout.LabelField("Tools", EditorStyles.boldLabel);

        if (GUILayout.Button("Validate Setup"))
        {
            _problems = new List<string>(controller.Validate());
            _validated = true;
        }

        using (new EditorGUI.DisabledScope(controller.Config == null))
        {
            if (GUILayout.Button("Preview Idle"))
            {
                controller.Bind();
                controller.ResetMachine();
                MarkDirty(controller);
            }

            if (GUILayout.Button("Test Forced Win"))
            {
                PreviewBestWin(controller);
            }

            if (GUILayout.Button("Preview Random Line"))
            {
                PreviewRandomLine(controller);
            }
        }

        using (new EditorGUI.DisabledScope(!Application.isPlaying))
        {
            if (GUILayout.Button(Application.isPlaying ? "Test Random Spin" : "Test Random Spin (play mode only)"))
            {
                controller.Spin();
            }
        }

        if (GUILayout.Button("Reset Preview"))
        {
            controller.ResetMachine();
            MarkDirty(controller);
        }

        if (!_validated)
        {
            return;
        }

        EditorGUILayout.Space();
        if (_problems == null || _problems.Count == 0)
        {
            EditorGUILayout.HelpBox("Setup is complete.", MessageType.Info);
            return;
        }

        for (int i = 0; i < _problems.Count; i++)
        {
            EditorGUILayout.HelpBox(_problems[i], MessageType.Warning);
        }
    }

    /// <summary>
    /// Finds the highest-priority line the strips can actually produce and shows it. Searching
    /// rather than hard-coding means the button keeps working when the paytable or the strips change.
    /// </summary>
    private static void PreviewBestWin(SlotMachineController controller)
    {
        var config = controller.Config;
        var paytable = config == null ? null : config.Paytable;
        if (paytable == null)
        {
            Debug.LogWarning("[Slot] no paytable, so there is no win to preview.", controller);
            return;
        }

        var left = config.Reel(0);
        var center = config.Reel(1);
        var right = config.Reel(2);
        if (left == null || center == null || right == null || left.Count == 0 || center.Count == 0 || right.Count == 0)
        {
            Debug.LogWarning("[Slot] the config has no reel strips to preview.", controller);
            return;
        }

        var line = new SlotReelItem[SlotMachineResult.ReelCount];
        SlotMachineResult best = null;
        float bestMultiplier = float.NegativeInfinity;

        for (int a = 0; a < left.Count; a++)
        {
            for (int b = 0; b < center.Count; b++)
            {
                for (int c = 0; c < right.Count; c++)
                {
                    line[0] = left[a];
                    line[1] = center[b];
                    line[2] = right[c];
                    var match = paytable.Evaluate(line);
                    if (!match.IsWin || match.Multiplier <= bestMultiplier)
                    {
                        continue;
                    }

                    bestMultiplier = match.Multiplier;
                    best = SlotMachineResult.FromIndices(a, b, c);
                }
            }
        }

        if (best == null)
        {
            Debug.LogWarning("[Slot] no combination of these strips matches any paytable line. " +
                             "Check that each reel carries the symbols and values the paytable asks for.", controller);
            return;
        }

        controller.Bind();
        controller.ShowResultImmediately(best);
        Debug.Log("[Slot] forced win preview: " + controller.LastResult, controller);
        MarkDirty(controller);
    }

    private static void PreviewRandomLine(SlotMachineController controller)
    {
        var config = controller.Config;
        var result = SlotMachineResult.FromIndices(
            RandomIndex(config, 0),
            RandomIndex(config, 1),
            RandomIndex(config, 2));

        controller.Bind();
        controller.ShowResultImmediately(result);
        Debug.Log("[Slot] random line preview: " + controller.LastResult, controller);
        MarkDirty(controller);
    }

    private static int RandomIndex(SlotMachineConfig config, int reel)
    {
        var strip = config == null ? null : config.Reel(reel);
        return strip == null || strip.Count == 0 ? 0 : Random.Range(0, strip.Count);
    }

    private static void MarkDirty(SlotMachineController controller)
    {
        if (Application.isPlaying)
        {
            return;
        }

        EditorUtility.SetDirty(controller);
        SceneView.RepaintAll();
    }
}
