using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// The Golden Luck slot machine. Owns the state machine, decides the result, walks the three reels
/// down onto it in turn, asks the paytable what it was worth and tells the view and the audio what
/// to do about it.
///
/// The maths never touches a UI component. This class knows about strips, positions and the
/// paytable; <see cref="SlotMachineView"/> and <see cref="SlotMachineEffects"/> know about images
/// and particles. That is the line that lets the reels be re-skinned, or driven headless in a test,
/// without touching a rule.
///
/// A spin is one coroutine, so the beats read in order in the source. Re-entry is blocked by
/// <see cref="CanSpin"/> rather than by a flag per beat, and every exit path runs through
/// <see cref="ReturnToIdle"/>, so a machine can never be left mid-spin with the audio still going.
///
/// Nothing here reads the keyboard. Input arrives as a call to <see cref="Spin"/>, from
/// <see cref="SlotMachineInput"/>, a UI button, or a show driving the studio.
/// </summary>
[DisallowMultipleComponent]
[RequireComponent(typeof(SlotMachineView))]
public class SlotMachineController : MonoBehaviour
{
    [Header("Setup")]
    [Tooltip("Reels, timings, paytable and FX parameters. Nothing runs without it.")]
    [SerializeField] private SlotMachineConfig config;

    [Tooltip("Draws the machine. Left empty, it is looked up on this object.")]
    [SerializeField] private SlotMachineView view;

    [Tooltip("Flashes, sweeps and dust. Optional: without it the machine plays with no effects.")]
    [SerializeField] private SlotMachineEffects effects;

    [Tooltip("Optional. Without it the machine plays silently.")]
    [SerializeField] private SlotMachineAudio audioRig;

    [Header("Behaviour")]
    [Tooltip("Run the idle animation while waiting. Turn off for a machine dressed into a still shot.")]
    [SerializeField] private bool animateWhileIdle = true;

    [Tooltip("Write every state change to the console, prefixed with [Slot].")]
    [SerializeField] private bool logStateChanges = true;

    private readonly SlotReelItem[] _winLine = new SlotReelItem[SlotMachineResult.ReelCount];
    private readonly List<string> _problems = new List<string>();

    private System.Random _random;
    private Coroutine _spin;
    private SlotMachineResult _result;
    private float _stateEnteredAt;

    /// <summary>Raised as a spin begins, before the reels move.</summary>
    public event Action SpinStarted;

    /// <summary>Raised as each reel settles, with the reel index.</summary>
    public event Action<int> ReelStopped;

    /// <summary>Raised once the reaction has played, with the evaluated result.</summary>
    public event Action<SlotMachineResult> SpinCompleted;

    /// <summary>Raised when a win reaction starts, before it plays.</summary>
    public event Action<SlotMachineResult> WinStarted;

    /// <summary>Raised when the machine is ready for another spin.</summary>
    public event Action ReturnedToIdle;

    public SlotMachineState State { get; private set; } = SlotMachineState.Disabled;

    /// <summary>The last evaluated result, or the one being played. Null before the first spin.</summary>
    public SlotMachineResult LastResult { get { return _result; } }

    public SlotMachineConfig Config { get { return config; } }

    /// <summary>True only when a spin can start right now.</summary>
    public bool CanSpin
    {
        get { return isActiveAndEnabled && config != null && State == SlotMachineState.Idle; }
    }

    /// <summary>Seconds the machine has been in its current state.</summary>
    public float TimeInState { get { return Time.time - _stateEnteredAt; } }

    private void Awake()
    {
        if (view == null)
        {
            view = GetComponent<SlotMachineView>();
        }

        if (effects == null)
        {
            effects = GetComponentInChildren<SlotMachineEffects>();
        }

        if (audioRig == null)
        {
            audioRig = GetComponentInChildren<SlotMachineAudio>();
        }

        BuildRandom();
    }

    private void OnEnable()
    {
        if (config == null)
        {
            Debug.LogError("[Slot] no SlotMachineConfig on " + name + ", so the machine stays disabled.", this);
            SetState(SlotMachineState.Disabled);
            return;
        }

        Bind();
        ReturnToIdle(raiseEvent: false);
    }

    private void OnDisable()
    {
        CancelSpin(snapToResult: false);
        SetState(SlotMachineState.Disabled);
    }

    private void Update()
    {
        if (State == SlotMachineState.Disabled || config == null || view == null)
        {
            return;
        }

        float dt = Time.deltaTime;

        // One place ticks all three reels, so their motion cannot drift apart across frames.
        var reels = view.Reels;
        float slowest = 0f;
        for (int i = 0; i < reels.Length; i++)
        {
            var reel = reels[i];
            if (reel == null)
            {
                continue;
            }

            reel.Tick(dt);
            slowest = Mathf.Max(slowest, reel.StopProgress);
        }

        if (audioRig != null && (State == SlotMachineState.Spinning || State == SlotMachineState.Stopping))
        {
            audioRig.SetSpinSlowdown(slowest);
        }

        if (animateWhileIdle && State == SlotMachineState.Idle)
        {
            view.TickIdle(dt);
        }
    }

    /// <summary>Starts a spin, if one can start. A call while spinning is ignored, not queued.</summary>
    public void Spin()
    {
        if (!CanSpin)
        {
            if (logStateChanges)
            {
                Debug.Log("[Slot] Spin() ignored in state " + State, this);
            }

            return;
        }

        var result = config.ResultMode == SlotResultMode.Forced ? config.BuildForcedResult() : DrawRandomResult();
        StartSpin(result);
    }

    /// <summary>
    /// Starts a spin that lands on <paramref name="result"/>. Used by a show that already knows the
    /// outcome and by the forced-win tests. The positions are wrapped into each strip, so an index
    /// out of range lands somewhere real rather than throwing.
    /// </summary>
    public void SpinWithResult(SlotMachineResult result)
    {
        if (!CanSpin)
        {
            if (logStateChanges)
            {
                Debug.Log("[Slot] SpinWithResult() ignored in state " + State, this);
            }

            return;
        }

        if (result == null)
        {
            Debug.LogError("[Slot] SpinWithResult(null); use Spin() for a random result.", this);
            return;
        }

        var wrapped = SlotMachineResult.FromIndices(
            WrapForReel(0, result.ItemIndex(0)),
            WrapForReel(1, result.ItemIndex(1)),
            WrapForReel(2, result.ItemIndex(2)));
        StartSpin(wrapped);
    }

    /// <summary>
    /// Stops a spin early. With <paramref name="snapToResult"/> the reels jump straight to the
    /// result that was already decided, so the machine still shows a legitimate outcome; without it
    /// they go back to their resting position.
    /// </summary>
    public void CancelSpin(bool snapToResult)
    {
        if (_spin != null)
        {
            StopCoroutine(_spin);
            _spin = null;
        }

        if (audioRig != null)
        {
            audioRig.StopAll();
        }

        if (effects != null)
        {
            effects.StopAll();
        }

        if (view == null)
        {
            return;
        }

        var reels = view.Reels;
        for (int i = 0; i < reels.Length; i++)
        {
            if (reels[i] == null)
            {
                continue;
            }

            if (snapToResult && _result != null)
            {
                reels[i].SnapTo(_result.ItemIndex(i));
            }
            else
            {
                reels[i].ResetReel();
            }
        }

        view.ClearWinHighlight();
    }

    /// <summary>
    /// Everything back to a machine that has never played: no spin, no effects, no sound, reels at
    /// rest and the last result dropped. Safe at any point in a spin.
    /// </summary>
    public void ResetMachine()
    {
        CancelSpin(snapToResult: false);
        _result = null;
        BuildRandom();

        if (view != null)
        {
            view.ResetVisuals();
        }

        if (config != null)
        {
            ReturnToIdle(raiseEvent: true);
        }
        else
        {
            SetState(SlotMachineState.Disabled);
        }
    }

    /// <summary>
    /// Puts a different config on the machine, which is how two rounds of a show play on one
    /// cabinet: the reels, the timings and the paytable all come from the config, so swapping it is
    /// the whole of the difference between them.
    ///
    /// A spin still running is dropped rather than finished. Its result names positions on the old
    /// strips, and the new strips can be a different length, so carrying it over would land the
    /// reels somewhere the paytable never agreed to.
    /// </summary>
    public void ApplyConfig(SlotMachineConfig next)
    {
        if (next == null)
        {
            Debug.LogError("[Slot] ApplyConfig(null) ignored on " + name + ", the machine keeps its config.", this);
            return;
        }

        if (ReferenceEquals(next, config))
        {
            return;
        }

        if (logStateChanges)
        {
            string previous = config == null ? "<none>" : config.name;
            Debug.Log("[Slot] config " + previous + " -> " + next.name, this);
        }

        CancelSpin(snapToResult: false);
        config = next;
        _result = null;
        BuildRandom();

        // Bind re-reads the strips onto the reels and the medallions, so it has to run before
        // anything draws again.
        Bind();
        ReturnToIdle(raiseEvent: true);
    }

    /// <summary>
    /// Lights the winning line up again, for a show that holds a close-up after the machine's own
    /// reaction has already faded. Does nothing when the last spin lost or none has run.
    ///
    /// Only the reel highlight is restored. The horseshoe glow is not, because the idle animation
    /// writes to it every frame and would take it straight back off.
    /// </summary>
    public void HighlightLastResult()
    {
        if (view == null || _result == null || !_result.IsWin)
        {
            return;
        }

        view.SetWinHighlight(_result, 1f);
    }

    /// <summary>
    /// Finds a line that pays the paytable combination called <paramref name="combinationId"/>, so a
    /// show can ask for "three_stars" without knowing which strip position that is on each reel.
    /// Returns false when no combination of the three strips produces it, which is the honest answer
    /// when a strip has been edited to no longer carry the symbol a line needs.
    ///
    /// The search is the full cross product of the three strips. With strips this size that is a few
    /// hundred evaluations, run once per spin, so it costs nothing worth caching.
    /// </summary>
    public bool TryBuildResultFor(string combinationId, out SlotMachineResult result)
    {
        result = null;
        if (config == null || config.Paytable == null || string.IsNullOrEmpty(combinationId))
        {
            return false;
        }

        return SearchLine(match => match.IsWin &&
                                   string.Equals(match.CombinationId, combinationId, StringComparison.OrdinalIgnoreCase),
            out result);
    }

    /// <summary>Finds a line that pays nothing, for a show that needs to land on a loss.</summary>
    public bool TryBuildLosingResult(out SlotMachineResult result)
    {
        return SearchLine(match => !match.IsWin, out result);
    }

    private bool SearchLine(Func<SlotPaytableMatch, bool> wanted, out SlotMachineResult result)
    {
        result = null;
        if (config == null)
        {
            return false;
        }

        var left = config.Reel(0);
        var center = config.Reel(1);
        var right = config.Reel(2);
        if (left == null || center == null || right == null)
        {
            return false;
        }

        var paytable = config.Paytable;
        for (int a = 0; a < left.Count; a++)
        {
            for (int b = 0; b < center.Count; b++)
            {
                for (int c = 0; c < right.Count; c++)
                {
                    _winLine[0] = left[a];
                    _winLine[1] = center[b];
                    _winLine[2] = right[c];
                    var match = paytable == null ? SlotPaytableMatch.NoWin : paytable.Evaluate(_winLine);
                    if (!wanted(match))
                    {
                        continue;
                    }

                    result = SlotMachineResult.FromIndices(a, b, c);
                    return true;
                }
            }
        }

        return false;
    }

    /// <summary>
    /// Everything wrong with the wiring and the config, as one list. Used by the inspector's
    /// Validate Setup and by the tests, so both judge the prefab by the same rules.
    /// </summary>
    public List<string> Validate()
    {
        _problems.Clear();

        if (config == null)
        {
            _problems.Add("No SlotMachineConfig.");
        }
        else
        {
            config.CollectProblems(_problems);
        }

        if (view == null)
        {
            _problems.Add("No SlotMachineView.");
        }
        else
        {
            view.CollectProblems(_problems);
        }

        if (effects == null)
        {
            _problems.Add("No SlotMachineEffects; the machine will play without flashes or dust.");
        }
        else
        {
            effects.CollectProblems(_problems);
        }

        if (audioRig == null)
        {
            _problems.Add("No SlotMachineAudio; the machine will play silently.");
        }
        else
        {
            audioRig.CollectProblems(_problems);
        }

        return _problems;
    }

    /// <summary>Binds the view, effects and audio to the config. Safe to call again.</summary>
    public void Bind()
    {
        if (view != null)
        {
            view.Bind(config);
        }

        if (effects != null)
        {
            effects.Bind(config);
        }

        if (audioRig != null)
        {
            audioRig.Bind(config);
        }
    }

    /// <summary>
    /// Drops the reels onto <paramref name="result"/> with no motion and evaluates it. This is how
    /// the editor previews a combination without entering play mode.
    /// </summary>
    public void ShowResultImmediately(SlotMachineResult result)
    {
        if (view == null || result == null)
        {
            return;
        }

        var reels = view.Reels;
        for (int i = 0; i < reels.Length; i++)
        {
            if (reels[i] != null)
            {
                reels[i].SnapTo(result.ItemIndex(i));
            }
        }

        _result = result;
        Evaluate(_result);
        view.SetWinHighlight(_result, _result.IsWin ? 1f : 0f);
    }

    /// <summary>
    /// Everything a spin does the instant it is asked for: the state changes, the reels start
    /// turning, the sound starts and the event fires. It is deliberately not inside the coroutine,
    /// because a coroutine's first segment does not run until the player loop ticks — so a caller
    /// that spins and immediately reads <see cref="State"/> would see Idle, and an edit-time test
    /// would see nothing happen at all.
    /// </summary>
    private void StartSpin(SlotMachineResult result)
    {
        _result = result;
        _result.ClearEvaluation();

        SetState(SlotMachineState.Starting);

        if (effects != null)
        {
            effects.SetIdle(false);
        }

        view.ClearWinHighlight();

        if (audioRig != null)
        {
            audioRig.PlaySpinStart();
            audioRig.StartSpinLoop();
        }

        var reels = view.Reels;
        for (int i = 0; i < reels.Length; i++)
        {
            if (reels[i] != null)
            {
                reels[i].BeginSpin(config.StartStaggerSeconds * i);
            }
        }

        var handler = SpinStarted;
        if (handler != null)
        {
            handler();
        }

        if (!Application.isPlaying)
        {
            // Outside play mode nothing ticks the reels, so there is no timed part to run. The reels
            // are left turning and a caller drives them itself, which is what the tests do.
            return;
        }

        _spin = StartCoroutine(RunSpin(_result));
    }

    private IEnumerator RunSpin(SlotMachineResult result)
    {
        var reels = view.Reels;

        // Starting lasts until the last reel has finished accelerating.
        yield return new WaitForSeconds(config.SpinUpSeconds + config.StartStaggerSeconds * (reels.Length - 1));

        SetState(SlotMachineState.Spinning);
        yield return new WaitForSeconds(config.SpinSeconds);

        SetState(SlotMachineState.Stopping);
        for (int i = 0; i < reels.Length; i++)
        {
            var reel = reels[i];
            if (reel == null)
            {
                continue;
            }

            reel.RequestStop(result.ItemIndex(i));

            while (reel.IsSpinning)
            {
                yield return null;
            }

            if (audioRig != null)
            {
                audioRig.PlayReelStop(i);
            }

            var stopped = ReelStopped;
            if (stopped != null)
            {
                stopped(i);
            }

            // The next reel is told to stop a beat later, which is what makes the three land in turn.
            if (i + 1 < reels.Length && config.StopDelaySeconds > 0f)
            {
                yield return new WaitForSeconds(config.StopDelaySeconds);
            }
        }

        if (audioRig != null)
        {
            audioRig.StopSpinLoop();
        }

        SetState(SlotMachineState.Evaluating);
        Evaluate(result);

        if (result.IsWin)
        {
            SetState(SlotMachineState.Win);

            var winStarted = WinStarted;
            if (winStarted != null)
            {
                winStarted(result);
            }

            if (audioRig != null)
            {
                audioRig.PlayWin();
            }

            if (effects != null)
            {
                effects.PlayWin();
            }

            yield return RampWin(result);
        }
        else
        {
            SetState(SlotMachineState.Lose);

            if (audioRig != null)
            {
                audioRig.PlayLose();
            }

            if (effects != null)
            {
                effects.PlayLose();
            }

            yield return new WaitForSeconds(config.LoseHoldSeconds);
        }

        var completed = SpinCompleted;
        if (completed != null)
        {
            completed(result);
        }

        SetState(SlotMachineState.Cooldown);
        yield return new WaitForSeconds(config.CooldownSeconds);

        _spin = null;
        ReturnToIdle(raiseEvent: true);
    }

    /// <summary>
    /// Rises into the win look, holds, then eases back so the machine returns to idle without a cut.
    /// </summary>
    private IEnumerator RampWin(SlotMachineResult result)
    {
        float rise = Mathf.Min(0.35f, config.WinHoldSeconds * 0.25f);
        float fall = Mathf.Min(0.5f, config.WinHoldSeconds * 0.3f);
        float hold = Mathf.Max(0f, config.WinHoldSeconds - rise - fall);
        float idleGlow = config.HorseshoeIdleGlow;

        yield return Ramp(rise, 0f, 1f, result, idleGlow);
        view.SetWinHighlight(result, 1f);
        view.SetHorseshoeGlow(config.WinGlowPeak);
        yield return new WaitForSeconds(hold);
        yield return Ramp(fall, 1f, 0f, result, idleGlow);

        view.ClearWinHighlight();
        view.SetHorseshoeGlow(idleGlow);
    }

    private IEnumerator Ramp(float duration, float from, float to, SlotMachineResult result, float idleGlow)
    {
        if (duration <= 0f)
        {
            yield break;
        }

        float t = 0f;
        while (t < duration)
        {
            t += Time.deltaTime;
            float amount = Mathf.Lerp(from, to, Mathf.SmoothStep(0f, 1f, t / duration));
            view.SetWinHighlight(result, amount);
            view.SetHorseshoeGlow(Mathf.Lerp(idleGlow, config.WinGlowPeak, amount));
            yield return null;
        }
    }

    private void Evaluate(SlotMachineResult result)
    {
        var reels = view.Reels;
        for (int i = 0; i < _winLine.Length; i++)
        {
            var strip = config.Reel(i);
            _winLine[i] = strip == null || strip.Count == 0 ? null : strip[result.ItemIndex(i)];

            // The reel is the authority on what is on screen, so a mismatch here is a real bug and
            // must not be papered over by reading the reel instead.
            if (reels != null && i < reels.Length && reels[i] != null && reels[i].Phase == SlotReelController.ReelPhase.Idle)
            {
                int shown = reels[i].WinLineItemIndex;
                if (shown != result.ItemIndex(i))
                {
                    Debug.LogError("[Slot] reel " + i + " shows position " + shown + " but the result says " +
                                   result.ItemIndex(i) + ". The reel landing is out of step with the result.", this);
                }
            }
        }

        var paytable = config.Paytable;
        result.ApplyEvaluation(paytable == null ? SlotPaytableMatch.NoWin : paytable.Evaluate(_winLine));

        if (logStateChanges)
        {
            Debug.Log("[Slot] line = " + Describe() + " -> " + result, this);
        }
    }

    private string Describe()
    {
        return (_winLine[0] == null ? "?" : _winLine[0].ToString()) + " | " +
               (_winLine[1] == null ? "?" : _winLine[1].ToString()) + " | " +
               (_winLine[2] == null ? "?" : _winLine[2].ToString());
    }

    private SlotMachineResult DrawRandomResult()
    {
        var indices = new int[SlotMachineResult.ReelCount];
        for (int i = 0; i < indices.Length; i++)
        {
            var strip = config.Reel(i);
            indices[i] = strip == null ? 0 : Mathf.Max(0, strip.DrawWeightedIndex(_random));
        }

        return SlotMachineResult.FromIndices(indices[0], indices[1], indices[2]);
    }

    private int WrapForReel(int reel, int index)
    {
        var strip = config.Reel(reel);
        return strip == null ? 0 : strip.Wrap(index);
    }

    private void BuildRandom()
    {
        // A fixed seed makes a run repeatable, which is what the seed test relies on. Rebuilt on
        // reset so the same seed replays from the top rather than continuing the old sequence.
        int seed = config != null && config.UseFixedSeed ? config.RandomSeed : Environment.TickCount;
        _random = new System.Random(seed);
    }

    private void ReturnToIdle(bool raiseEvent)
    {
        SetState(SlotMachineState.Idle);

        if (effects != null)
        {
            effects.SetIdle(animateWhileIdle);
        }

        if (!raiseEvent)
        {
            return;
        }

        var handler = ReturnedToIdle;
        if (handler != null)
        {
            handler();
        }
    }

    private void SetState(SlotMachineState next)
    {
        if (State == next)
        {
            return;
        }

        if (logStateChanges)
        {
            Debug.Log("[Slot] " + State + " -> " + next + " (held " + TimeInState.ToString("0.00") + "s)", this);
        }

        State = next;
        _stateEnteredAt = Time.time;
    }

    private void OnValidate()
    {
        // Reference lookups only. Nothing that walks the strips or touches assets, so dragging the
        // prefab around never stalls the editor.
        if (view == null)
        {
            view = GetComponent<SlotMachineView>();
        }

        if (effects == null)
        {
            effects = GetComponentInChildren<SlotMachineEffects>();
        }

        if (audioRig == null)
        {
            audioRig = GetComponentInChildren<SlotMachineAudio>();
        }
    }
}
