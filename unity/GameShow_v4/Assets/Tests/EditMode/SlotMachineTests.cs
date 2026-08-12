using System.Collections.Generic;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Tests for the parts of the machine that have a right answer: the state machine, the landing, the
/// draw, the paytable and the prefab's wiring.
///
/// Nothing here looks at pixels. What a spin looks like is judged by eye in the test scene; what it
/// means is judged here.
///
/// The reels are ticked with a fixed time step rather than by waiting for frames, so a whole spin
/// runs in microseconds and always the same way.
/// </summary>
public class SlotMachineTests
{
    private const string ConfigPath = "Assets/Prefabs/SlotMachine/GoldenLuck_DefaultConfig.asset";
    private const string PaytablePath = "Assets/Prefabs/SlotMachine/GoldenLuck_Paytable.asset";
    private const string PrefabPath = "Assets/Prefabs/GoldenLuck_SlotMachine.prefab";

    private const float Step = 1f / 60f;
    private const int MaxSteps = 4000;

    private readonly List<GameObject> _spawned = new List<GameObject>();

    [TearDown]
    public void TearDown()
    {
        for (int i = 0; i < _spawned.Count; i++)
        {
            if (_spawned[i] != null)
            {
                Object.DestroyImmediate(_spawned[i]);
            }
        }

        _spawned.Clear();
    }

    // ---------------------------------------------------------------- reel landing

    [Test]
    public void ReelLandsOnTheRequestedPosition([Values(0, 1, 2)] int reel)
    {
        var config = LoadConfig();
        var strip = config.Reel(reel);

        for (int target = 0; target < strip.Count; target++)
        {
            var controller = NewReel(config, reel);
            controller.BeginSpin(0f);

            // Spin up first, so the stop is worked out from the speed the reel really has.
            Run(controller, config.SpinUpSeconds + 0.2f);
            controller.RequestStop(target);
            Assert.AreEqual(target, controller.StopTargetIndex, "reel " + reel + " took the wrong stop target");

            int steps = 0;
            while (controller.IsSpinning && steps++ < MaxSteps)
            {
                controller.Tick(Step);
            }

            Assert.Less(steps, MaxSteps, "reel " + reel + " never settled for target " + target);
            Assert.AreEqual(target, controller.WinLineItemIndex,
                "reel " + reel + " was told to stop on " + target + " and shows " + controller.WinLineItemIndex);
            Assert.AreEqual(controller.Position, Mathf.Round(controller.Position), 1e-4f,
                "reel " + reel + " settled between positions, which would read as a misaligned reel");
        }
    }

    [Test]
    public void ReelBounceNeverChangesTheItemOnTheWinLine()
    {
        var config = LoadConfig();
        var controller = NewReel(config, 0);
        controller.BeginSpin(0f);
        Run(controller, config.SpinUpSeconds + 0.2f);
        controller.RequestStop(3);

        int steps = 0;
        bool sawBounce = false;
        while (controller.IsSpinning && steps++ < MaxSteps)
        {
            controller.Tick(Step);
            if (controller.Phase != SlotReelController.ReelPhase.Bouncing)
            {
                continue;
            }

            sawBounce = true;
            Assert.AreEqual(3, controller.WinLineItemIndex, "the bounce moved the win line onto another item");
        }

        Assert.IsTrue(sawBounce, "the reel never bounced, so this test proved nothing");
        Assert.AreEqual(3, controller.WinLineItemIndex);
    }

    [Test]
    public void SnapToPutsTheWantedItemOnTheWinLine([Values(0, 1, 2)] int reel)
    {
        var config = LoadConfig();
        var controller = NewReel(config, reel);
        var strip = config.Reel(reel);

        for (int target = 0; target < strip.Count; target++)
        {
            controller.SnapTo(target);
            Assert.AreEqual(target, controller.WinLineItemIndex);
            Assert.IsFalse(controller.IsSpinning);
        }
    }

    [Test]
    public void ReelAtRestShowsTheCabinetReferenceOrder()
    {
        // The machine at rest must read exactly as the orthographic front view paints it: the first
        // four strip positions, top to bottom, with the third of them on the win line.
        var config = LoadConfig();
        for (int reel = 0; reel < SlotMachineResult.ReelCount; reel++)
        {
            var controller = NewReel(config, reel);
            Assert.AreEqual(0f, controller.Position, "reel " + reel + " does not rest at position 0");
            Assert.AreEqual(config.WinLineCell, controller.WinLineItemIndex,
                "reel " + reel + " rests with the wrong item on the win line");
        }
    }

    // ---------------------------------------------------------------- state machine

    [Test]
    public void SpinIsRefusedWhileAlreadySpinning()
    {
        var machine = NewMachine();
        Assert.IsTrue(machine.CanSpin, "a fresh machine should be ready to spin");

        machine.Spin();
        Assert.AreNotEqual(SlotMachineState.Idle, machine.State, "Spin() did not leave Idle");
        Assert.IsFalse(machine.CanSpin, "a spinning machine must refuse another spin");

        var before = machine.LastResult;
        machine.Spin();
        machine.SpinWithResult(SlotMachineResult.FromIndices(0, 0, 0));
        Assert.AreSame(before, machine.LastResult, "a second Spin() replaced the result of the one in flight");
    }

    [Test]
    public void ResetReturnsToIdleFromMidSpin()
    {
        var machine = NewMachine();
        machine.Spin();
        Assert.AreNotEqual(SlotMachineState.Idle, machine.State);

        machine.ResetMachine();

        Assert.AreEqual(SlotMachineState.Idle, machine.State);
        Assert.IsTrue(machine.CanSpin);
        Assert.IsNull(machine.LastResult, "reset kept the last result");

        var view = machine.GetComponent<SlotMachineView>();
        for (int i = 0; i < view.Reels.Length; i++)
        {
            Assert.IsFalse(view.Reels[i].IsSpinning, "reel " + i + " was left spinning after a reset");
            Assert.AreEqual(0f, view.Reels[i].Position, "reel " + i + " was not put back to rest");
        }
    }

    [Test]
    public void CancelSpinSnapsToTheDecidedResult()
    {
        var machine = NewMachine();
        var wanted = SlotMachineResult.FromIndices(3, 4, 5);
        machine.SpinWithResult(wanted);

        machine.CancelSpin(snapToResult: true);

        var view = machine.GetComponent<SlotMachineView>();
        for (int i = 0; i < SlotMachineResult.ReelCount; i++)
        {
            Assert.IsFalse(view.Reels[i].IsSpinning);
            Assert.AreEqual(machine.LastResult.ItemIndex(i), view.Reels[i].WinLineItemIndex,
                "reel " + i + " did not snap onto the decided result");
        }
    }

    [Test]
    public void ADisabledMachineRefusesToSpin()
    {
        var machine = NewMachine();
        machine.enabled = false;

        // The state itself is only moved to Disabled by OnDisable, which edit mode does not call.
        // CanSpin is the thing that must hold either way, because it reads isActiveAndEnabled.
        Assert.IsFalse(machine.CanSpin, "a disabled machine reported that it could spin");

        machine.Spin();

        var view = machine.GetComponent<SlotMachineView>();
        for (int i = 0; i < view.Reels.Length; i++)
        {
            Assert.IsFalse(view.Reels[i].IsSpinning, "a disabled machine started reel " + i);
        }
    }

    // ---------------------------------------------------------------- forced results

    [Test]
    public void ForcedResultStopsEveryReelOnItsPosition()
    {
        var config = LoadConfig();
        var machine = NewMachine();
        var wanted = SlotMachineResult.FromIndices(1, 3, 5);

        machine.SpinWithResult(wanted);
        RunWholeSpin(machine, config);

        var view = machine.GetComponent<SlotMachineView>();
        for (int i = 0; i < SlotMachineResult.ReelCount; i++)
        {
            Assert.AreEqual(wanted.ItemIndex(i), view.Reels[i].WinLineItemIndex,
                "reel " + i + " did not land on the forced position");
        }
    }

    [Test]
    public void OutOfRangeForcedPositionsWrapInsteadOfThrowing()
    {
        var config = LoadConfig();
        var machine = NewMachine();

        machine.SpinWithResult(SlotMachineResult.FromIndices(-1, 999, 0));

        var left = config.Reel(0);
        var center = config.Reel(1);
        Assert.AreEqual(left.Wrap(-1), machine.LastResult.ItemIndex(0));
        Assert.AreEqual(center.Wrap(999), machine.LastResult.ItemIndex(1));
    }

    [Test]
    public void EveryPaytableCombinationCanBeForcedAndPaysItself()
    {
        var config = LoadConfig();
        var paytable = LoadPaytable();
        var machine = NewMachine();
        int checked_ = 0;

        foreach (var combination in paytable.Combinations)
        {
            SlotMachineResult forced;
            Assert.IsTrue(machine.TryBuildResultFor(combination.id, out forced),
                "no line on these strips pays '" + combination.id + "'");

            machine.ResetMachine();
            machine.SpinWithResult(forced);
            RunWholeSpin(machine, config);

            var result = machine.LastResult;
            Assert.IsTrue(result.IsWin, "'" + combination.id + "' was forced and did not read as a win");
            Assert.AreEqual(combination.id, result.CombinationId,
                "forcing '" + combination.id + "' paid '" + result.CombinationId + "' instead");
            Assert.Greater(result.Reward, 0, "'" + combination.id + "' paid nothing");
            checked_++;
        }

        Assert.Greater(checked_, 0, "the paytable is empty, so this test proved nothing");
    }

    [Test]
    public void ALosingLineCanBeForcedAndPaysNothing()
    {
        var config = LoadConfig();
        var machine = NewMachine();

        SlotMachineResult losing;
        Assert.IsTrue(machine.TryBuildLosingResult(out losing), "no line on these strips loses");

        machine.SpinWithResult(losing);
        RunWholeSpin(machine, config);

        Assert.IsFalse(machine.LastResult.IsWin);
        Assert.AreEqual(0, machine.LastResult.Reward);
        Assert.IsEmpty(machine.LastResult.MatchedReels);
    }

    // ---------------------------------------------------------------- the draw

    [Test]
    public void TheSameSeedDrawsTheSameSequence()
    {
        var config = LoadConfig();
        Assert.IsTrue(config.UseFixedSeed,
            "this test only means something with a fixed seed; " + config.name + " has it turned off");

        var first = DrawSequence(config, 24);
        var second = DrawSequence(config, 24);

        Assert.AreEqual(first, second, "the same seed drew two different sequences");
    }

    [Test]
    public void ADifferentSeedDrawsADifferentSequence()
    {
        var config = LoadConfig();
        var strip = config.Reel(0);

        var a = new List<int>();
        var b = new List<int>();
        var randomA = new System.Random(config.RandomSeed);
        var randomB = new System.Random(config.RandomSeed + 1);
        for (int i = 0; i < 40; i++)
        {
            a.Add(strip.DrawWeightedIndex(randomA));
            b.Add(strip.DrawWeightedIndex(randomB));
        }

        Assert.AreNotEqual(a, b, "two different seeds produced the same 40 draws");
    }

    [Test]
    public void AZeroWeightPositionIsNeverDrawn()
    {
        var strip = new SlotReelStrip();
        strip.items.Add(new SlotReelItem { id = "never", weight = 0f });
        strip.items.Add(new SlotReelItem { id = "always", weight = 1f });

        var random = new System.Random(7);
        for (int i = 0; i < 500; i++)
        {
            Assert.AreEqual(1, strip.DrawWeightedIndex(random), "a zero-weight position was drawn");
        }
    }

    [Test]
    public void EveryPositionOfTheDefaultStripsCanBeDrawn()
    {
        var config = LoadConfig();
        for (int reel = 0; reel < SlotMachineResult.ReelCount; reel++)
        {
            var strip = config.Reel(reel);
            var seen = new HashSet<int>();
            var random = new System.Random(1234 + reel);
            for (int i = 0; i < 20000; i++)
            {
                seen.Add(strip.DrawWeightedIndex(random));
            }

            Assert.AreEqual(strip.Count, seen.Count,
                "reel " + reel + " has positions that 20000 draws never reached, so a weight is 0 by mistake");
        }
    }

    // ---------------------------------------------------------------- paytable

    [Test]
    public void PaytableFindsThreeOfEachSymbol([Values(SlotSymbolId.Star, SlotSymbolId.Bell, SlotSymbolId.Horseshoe)] SlotSymbolId symbol)
    {
        var paytable = LoadPaytable();
        var line = new[] { Symbol(symbol), Symbol(symbol), Symbol(symbol) };

        var match = paytable.Evaluate(line);

        Assert.IsTrue(match.IsWin, "three " + symbol + "s did not pay");
        Assert.Greater(match.Multiplier, 0f);
        Assert.AreEqual(SlotMachineResult.ReelCount, match.MatchedReels.Length);
    }

    [Test]
    public void PaytableFindsThreeMatchingNumbersAndPaysWhatTheNumberSays()
    {
        var paytable = LoadPaytable();
        var line = new[] { Value("10", 10f), Value("10", 10f), Value("10", 10f) };

        var match = paytable.Evaluate(line);

        Assert.IsTrue(match.IsWin, "a triple of 10s did not pay");
        Assert.AreEqual(10f, match.Multiplier, 1e-4f, "a triple of 10s did not pay ten times");
    }

    [Test]
    public void PaytableFindsTheMixedStarBellHorseshoeLine()
    {
        var paytable = LoadPaytable();
        var line = new[] { Symbol(SlotSymbolId.Star), Symbol(SlotSymbolId.Bell), Symbol(SlotSymbolId.Horseshoe) };

        var match = paytable.Evaluate(line);

        Assert.IsTrue(match.IsWin, "the machine's own three medallions did not pay");
    }

    [Test]
    public void PaytableRejectsAMixedLine()
    {
        var paytable = LoadPaytable();
        var line = new[] { Value("20", 20f), Value("6", 6f), Symbol(SlotSymbolId.Horseshoe) };

        Assert.IsFalse(paytable.Evaluate(line).IsWin, "an unmatched line paid out");
    }

    [Test]
    public void PaytableRejectsNumbersThatOnlyLookAlike()
    {
        var paytable = LoadPaytable();
        var line = new[] { Value("10", 10f), Value("10", 10f), Value("5", 5f) };

        Assert.IsFalse(paytable.Evaluate(line).IsWin, "two of a kind paid as three");
    }

    [Test]
    public void PaytableTakesTheHighestPriorityLineWhenSeveralMatch()
    {
        // The shipped lines are deliberately disjoint, so priority never decides anything there.
        // This builds a paytable where two lines do overlap and checks that priority alone picks the
        // winner, in both directions, which is what proves the rule rather than the data.
        var line = new[] { Symbol(SlotSymbolId.Star), Symbol(SlotSymbolId.Star), Symbol(SlotSymbolId.Star) };

        Assert.AreEqual("specific", BuildPaytable(specificPriority: 10, genericPriority: 1).Evaluate(line).CombinationId);
        Assert.AreEqual("generic", BuildPaytable(specificPriority: 1, genericPriority: 10).Evaluate(line).CombinationId);
    }

    /// <summary>
    /// A throwaway paytable with two overlapping lines. Written through
    /// <see cref="JsonUtility.FromJsonOverwrite"/> so the production type keeps no setter it only
    /// needs for a test.
    /// </summary>
    private static SlotPaytable BuildPaytable(int specificPriority, int genericPriority)
    {
        var paytable = ScriptableObject.CreateInstance<SlotPaytable>();
        string json =
            "{\"combinations\":[" +
            "{\"id\":\"specific\",\"kind\":" + (int)SlotMatchKind.SymbolTriple + ",\"symbol\":" + (int)SlotSymbolId.Star +
            ",\"multiplier\":50.0,\"baseReward\":100,\"priority\":" + specificPriority + "}," +
            "{\"id\":\"generic\",\"kind\":" + (int)SlotMatchKind.AnySymbolTriple +
            ",\"multiplier\":20.0,\"baseReward\":100,\"priority\":" + genericPriority + "}]}";
        JsonUtility.FromJsonOverwrite(json, paytable);

        Assert.AreEqual(2, paytable.Combinations.Count, "the throwaway paytable did not deserialise");
        return paytable;
    }

    [Test]
    public void PaytableSurvivesAnIncompleteLine()
    {
        var paytable = LoadPaytable();

        Assert.IsFalse(paytable.Evaluate(null).IsWin);
        Assert.IsFalse(paytable.Evaluate(new SlotReelItem[] { Symbol(SlotSymbolId.Star) }).IsWin);
        Assert.IsFalse(paytable.Evaluate(new[] { Symbol(SlotSymbolId.Star), null, Symbol(SlotSymbolId.Star) }).IsWin);
    }

    // ---------------------------------------------------------------- assets and prefab

    [Test]
    public void TheDefaultConfigHasNoProblems()
    {
        var problems = new List<string>();
        LoadConfig().CollectProblems(problems);

        Assert.IsEmpty(problems, "the default config reports: " + string.Join(" | ", problems));
    }

    [Test]
    public void ThePrefabValidatesCleanlyApartFromMissingAudioClips()
    {
        var prefab = LoadPrefab();
        var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        _spawned.Add(instance);

        var controller = instance.GetComponent<SlotMachineController>();
        Assert.IsNotNull(controller, "the prefab has no SlotMachineController");

        var problems = new List<string>();
        foreach (var problem in controller.Validate())
        {
            // Sound design is expected to arrive after the machine does, so a config with no clips
            // is information, not a fault.
            if (problem.Contains("plays silently") || problem.Contains("carries no clips"))
            {
                continue;
            }

            problems.Add(problem);
        }

        Assert.IsEmpty(problems, "the prefab reports: " + string.Join(" | ", problems));
    }

    [Test]
    public void ThePrefabKeepsEveryUiAnchorAndSurfaceFromTheModel()
    {
        var prefab = LoadPrefab();
        var names = new HashSet<string>();
        foreach (var t in prefab.GetComponentsInChildren<Transform>(true))
        {
            names.Add(t.name);
        }

        var expected = new[]
        {
            "UI_Logo_Anchor", "UI_Logo_Surface",
            "UI_Reel_Left_Anchor", "UI_Reel_Left_Surface",
            "UI_Reel_Center_Anchor", "UI_Reel_Center_Surface",
            "UI_Reel_Right_Anchor", "UI_Reel_Right_Surface",
            "UI_Symbol_Left_Anchor", "UI_Symbol_Left_Surface",
            "UI_Symbol_Center_Anchor", "UI_Symbol_Center_Surface",
            "UI_Symbol_Right_Anchor", "UI_Symbol_Right_Surface",
            "UI_Horseshoe_Anchor", "UI_Horseshoe_Surface",
        };

        foreach (var name in expected)
        {
            Assert.IsTrue(names.Contains(name), "the prefab lost " + name + " from the model");
        }
    }

    [Test]
    public void ThePrefabIsTheRightSizeAndStandsOnTheFloor()
    {
        var prefab = LoadPrefab();
        var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        _spawned.Add(instance);
        instance.transform.position = Vector3.zero;
        instance.transform.rotation = Quaternion.identity;

        var renderers = instance.GetComponentsInChildren<MeshRenderer>(true);
        Assert.Greater(renderers.Length, 0);

        var bounds = renderers[0].bounds;
        foreach (var r in renderers)
        {
            bounds.Encapsulate(r.bounds);
        }

        Assert.AreEqual(1.80f, bounds.size.y, 0.02f, "the machine is not 1.80 m tall");
        Assert.AreEqual(0.855f, bounds.size.x, 0.02f, "the machine is not 0.855 m wide across the plinth");
        Assert.AreEqual(0.508f, bounds.size.z, 0.02f, "the machine is not 0.508 m deep across the plinth");
        Assert.AreEqual(0f, bounds.min.y, 0.005f, "the machine does not stand on Y = 0");
    }

    [Test]
    public void ThePrefabHasNoNegativeScaleAnywhere()
    {
        foreach (var t in LoadPrefab().GetComponentsInChildren<Transform>(true))
        {
            var s = t.localScale;
            Assert.IsTrue(s.x > 0f && s.y > 0f && s.z > 0f, t.name + " has a negative scale, which flips its winding");
        }
    }

    [Test]
    public void ThePrefabCarriesExactlyOneInteractionCollider()
    {
        var colliders = LoadPrefab().GetComponentsInChildren<Collider>(true);

        Assert.AreEqual(1, colliders.Length, "expected one interaction collider, found " + colliders.Length);
        Assert.IsInstanceOf<BoxCollider>(colliders[0], "the interaction collider should be a box, not a mesh");
    }

    [Test]
    public void MissingAudioClipsDoNotThrow()
    {
        var machine = NewMachine();
        var rig = machine.GetComponentInChildren<SlotMachineAudio>();
        Assert.IsNotNull(rig, "the prefab has no audio rig, so this test proved nothing");

        // The shipped config has no clips yet. Every call must be a no-op rather than a throw.
        Assert.DoesNotThrow(() =>
        {
            rig.PlaySpinStart();
            rig.StartSpinLoop();
            rig.SetSpinSlowdown(0.5f);
            rig.PlayReelStop(0);
            rig.PlayReelStop(9);
            rig.PlayWin();
            rig.PlayLose();
            rig.StopSpinLoop();
            rig.StopAll();
        });
    }

    // ---------------------------------------------------------------- helpers

    private static SlotMachineConfig LoadConfig()
    {
        var config = AssetDatabase.LoadAssetAtPath<SlotMachineConfig>(ConfigPath);
        Assert.IsNotNull(config, "no config at " + ConfigPath);
        return config;
    }

    private static SlotPaytable LoadPaytable()
    {
        var paytable = AssetDatabase.LoadAssetAtPath<SlotPaytable>(PaytablePath);
        Assert.IsNotNull(paytable, "no paytable at " + PaytablePath);
        return paytable;
    }

    private static GameObject LoadPrefab()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        Assert.IsNotNull(prefab, "no prefab at " + PrefabPath);
        return prefab;
    }

    /// <summary>A bare reel with no view, which is all the landing maths needs.</summary>
    private SlotReelController NewReel(SlotMachineConfig config, int reel)
    {
        var go = new GameObject("Reel_" + reel);
        _spawned.Add(go);
        var controller = go.AddComponent<SlotReelController>();
        controller.Initialize(config, reel);
        return controller;
    }

    /// <summary>A live prefab instance, so the tests judge the same wiring the scene uses.</summary>
    private SlotMachineController NewMachine()
    {
        var instance = (GameObject)PrefabUtility.InstantiatePrefab(LoadPrefab());
        _spawned.Add(instance);
        var controller = instance.GetComponent<SlotMachineController>();
        Assert.IsNotNull(controller);

        // Edit mode runs neither Awake nor OnEnable, and toggling `enabled` does not either, so a
        // freshly instantiated machine sits at Disabled with nothing bound. These two calls are what
        // OnEnable does in play mode, and they are public precisely so this and the inspector's
        // preview buttons can do it without entering play mode.
        controller.Bind();
        controller.ResetMachine();
        Assert.AreEqual(SlotMachineState.Idle, controller.State, "the machine did not come up idle");
        return controller;
    }

    private static void Run(SlotReelController reel, float seconds)
    {
        int steps = Mathf.CeilToInt(seconds / Step);
        for (int i = 0; i < steps; i++)
        {
            reel.Tick(Step);
        }
    }

    /// <summary>
    /// Drives every reel of a machine to rest by hand. Edit-mode tests get no frames, so the
    /// controller's coroutine never advances; the reels are told to stop directly instead, which is
    /// what the coroutine would have done.
    /// </summary>
    private static void RunWholeSpin(SlotMachineController machine, SlotMachineConfig config)
    {
        var reels = machine.GetComponent<SlotMachineView>().Reels;
        var result = machine.LastResult;

        for (int i = 0; i < reels.Length; i++)
        {
            Run(reels[i], config.SpinUpSeconds + 0.2f);
            reels[i].RequestStop(result.ItemIndex(i));

            int steps = 0;
            while (reels[i].IsSpinning && steps++ < MaxSteps)
            {
                reels[i].Tick(Step);
            }

            Assert.Less(steps, MaxSteps, "reel " + i + " never settled");
        }

        machine.ShowResultImmediately(result);
    }

    private static List<int> DrawSequence(SlotMachineConfig config, int count)
    {
        var draws = new List<int>();
        var random = new System.Random(config.RandomSeed);
        for (int i = 0; i < count; i++)
        {
            for (int reel = 0; reel < SlotMachineResult.ReelCount; reel++)
            {
                draws.Add(config.Reel(reel).DrawWeightedIndex(random));
            }
        }

        return draws;
    }

    private static SlotReelItem Symbol(SlotSymbolId symbol)
    {
        return new SlotReelItem { kind = SlotReelItemKind.Symbol, symbol = symbol, id = symbol.ToString() };
    }

    private static SlotReelItem Value(string text, float multiplier)
    {
        return new SlotReelItem { kind = SlotReelItemKind.Value, displayText = text, multiplier = multiplier, id = text };
    }
}
