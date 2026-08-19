using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Everything about how the machine plays and how long each beat lasts. The prefab holds the
/// wiring, this holds the content and the timing, so a second machine with different reels and a
/// slower spin is a second asset and no new components.
///
/// Deliberately not here: the sprites the prefab draws in fixed places, such as the reel overlays
/// and the horseshoe layers. Those are set once on their own Image and never chosen at runtime, so
/// listing them again here would just be two places to keep in step. What is here is what the
/// runtime picks between: the symbol on a reel position, and the FX textures the effects swap in.
/// </summary>
[CreateAssetMenu(menuName = "GameShow/Slot Machine/Config", fileName = "GoldenLuck_Config")]
public class SlotMachineConfig : ScriptableObject
{
    [Header("Reels")]
    [Tooltip("One strip per reel, left to right. Exactly three are expected.")]
    [SerializeField] private SlotReelStrip[] reels = new SlotReelStrip[SlotMachineResult.ReelCount];

    [Tooltip("How many positions the viewport shows at once. The cabinet reference paints four.")]
    [SerializeField, Range(1, 8)] private int visibleCells = 4;

    [Tooltip("Which of the visible positions is the win line, counted from the top. The reference " +
             "puts the side markers level with the third of four, so 2.")]
    [SerializeField, Min(0)] private int winLineCell = 2;

    [Header("Spin timing")]
    [Tooltip("Seconds the reels take to reach full speed.")]
    [SerializeField, Min(0.01f)] private float spinUpSeconds = 0.55f;

    [Tooltip("Seconds between the left reel starting and the next one, so they do not move as a block.")]
    [SerializeField, Min(0f)] private float startStaggerSeconds = 0.08f;

    [Tooltip("Seconds at full speed before the first reel is told to stop.")]
    [SerializeField, Min(0f)] private float spinSeconds = 1.6f;

    [Tooltip("Positions per second at full speed.")]
    [SerializeField, Min(0.1f)] private float cruiseCellsPerSecond = 14f;

    [Tooltip("Seconds between one reel stopping and the next being told to.")]
    [SerializeField, Min(0f)] private float stopDelaySeconds = 0.45f;

    [Tooltip("Seconds a single reel takes to slow from full speed to its result.")]
    [SerializeField, Min(0.05f)] private float reelStopSeconds = 0.95f;

    [Tooltip("Whole turns of the strip a reel adds before it is allowed to land, so a short stop " +
             "still reads as a spin rather than a nudge.")]
    [SerializeField, Min(0)] private int fullTurnsBeforeStop = 1;

    [Header("Spin shape")]
    [Tooltip("Speed against time while starting, 0-1 on both axes.")]
    [SerializeField] private AnimationCurve spinUpCurve = AnimationCurve.EaseInOut(0f, 0f, 1f, 1f);

    [Tooltip("Distance covered against time while stopping, 0-1 on both axes. Its slope at 0 sets " +
             "how far a reel needs to land, so an ease-out shape is what keeps the speed continuous.")]
    [SerializeField] private AnimationCurve stopCurve = new AnimationCurve(
        new Keyframe(0f, 0f, 2f, 2f),
        new Keyframe(1f, 1f, 0f, 0f));

    [Tooltip("How far past its result a reel overshoots, in positions. Under half a position, or " +
             "the item on the win line would change.")]
    [SerializeField, Range(0f, 0.4f)] private float bounceCells = 0.07f;

    [Tooltip("Seconds the overshoot takes to settle back.")]
    [SerializeField, Min(0f)] private float bounceSeconds = 0.22f;

    [Tooltip("Overshoot against time, 0-1 in and a signed offset out.")]
    [SerializeField] private AnimationCurve bounceCurve = new AnimationCurve(
        new Keyframe(0f, 1f),
        new Keyframe(0.55f, -0.32f),
        new Keyframe(1f, 0f));

    [Header("Result")]
    [Tooltip("Random draws from the weights. Forced replays the result below, which is what a show " +
             "or a test uses.")]
    [SerializeField] private SlotResultMode resultMode = SlotResultMode.Random;

    [Tooltip("Strip position per reel used in Forced mode.")]
    [SerializeField] private int[] forcedItemIndices = new int[SlotMachineResult.ReelCount];

    [Tooltip("Seed the draw so a run repeats. Off takes a seed from the clock.")]
    [SerializeField] private bool useFixedSeed;

    [SerializeField] private int randomSeed = 20250812;

    [SerializeField] private SlotPaytable paytable;

    [Header("Reactions")]
    [Tooltip("Seconds the win effects run before the spin reports complete.")]
    [SerializeField, Min(0f)] private float winHoldSeconds = 2.4f;

    [Tooltip("Seconds the short neutral reaction to a loss takes.")]
    [SerializeField, Min(0f)] private float loseHoldSeconds = 0.6f;

    [Tooltip("Seconds after the reaction before another spin is allowed.")]
    [SerializeField, Min(0f)] private float cooldownSeconds = 0.4f;

    [Header("Idle")]
    [Tooltip("Seconds for one full breath of the logo.")]
    [SerializeField, Min(0.1f)] private float logoPulseSeconds = 3.4f;

    [Tooltip("How far the logo glow moves either side of its rest brightness.")]
    [SerializeField, Range(0f, 1f)] private float logoPulseAmount = 0.22f;

    [Tooltip("Rest brightness of the horseshoe glow while idle.")]
    [SerializeField, Range(0f, 1f)] private float horseshoeIdleGlow = 0.35f;

    [Tooltip("Seconds for one full breath of the horseshoe glow.")]
    [SerializeField, Min(0.1f)] private float horseshoePulseSeconds = 4.2f;

    [Tooltip("Seconds between light sweeps across the reel bay.")]
    [SerializeField, Min(0.5f)] private float lightSweepIntervalSeconds = 7f;

    [Tooltip("Seconds one sweep takes to cross.")]
    [SerializeField, Min(0.05f)] private float lightSweepSeconds = 1.1f;

    [Tooltip("Gold dust particles per second while idle. Keep it low; this is a background shimmer.")]
    [SerializeField, Min(0f)] private float idleDustRate = 1.5f;

    [Header("Win effects")]
    [Tooltip("Seconds the gold flash takes to rise and fall.")]
    [SerializeField, Min(0.05f)] private float winFlashSeconds = 0.55f;

    [Tooltip("Horseshoe glow at the peak of a win.")]
    [SerializeField, Range(0f, 2f)] private float winGlowPeak = 1f;

    [Tooltip("How much a matched symbol grows at the peak of a win. 0.12 is a 12% punch.")]
    [SerializeField, Range(0f, 0.6f)] private float winSymbolPunch = 0.14f;

    [Tooltip("Sweeps run across the gold frames when a win lands.")]
    [SerializeField, Min(0)] private int winSweepCount = 2;

    [Tooltip("Gold dust particles released at once on a win.")]
    [SerializeField, Min(0)] private int winDustBurst = 40;

    [Tooltip("Seconds of sparkles on the lower display after a win.")]
    [SerializeField, Min(0f)] private float winSparkleSeconds = 1.5f;

    [Header("FX sprites")]
    [Tooltip("The gold burst behind a win, on the lower display.")]
    [SerializeField] private Sprite winFlashSprite;

    [SerializeField] private Sprite sparkleStarSprite;
    [SerializeField] private Sprite sparkleSoftSprite;

    [Tooltip("The streak that runs along the gold frames.")]
    [SerializeField] private Sprite lightSweepSprite;

    [Header("Audio")]
    [Tooltip("Looped while the reels turn. Left empty, the machine runs silently and says so once.")]
    [SerializeField] private AudioClip spinLoopClip;

    [Tooltip("One click per reel as it lands. A single clip is reused for all three.")]
    [SerializeField] private AudioClip reelStopClip;

    [SerializeField] private AudioClip winClip;
    [SerializeField] private AudioClip loseClip;

    [Tooltip("Played when a spin is requested, before the reels move.")]
    [SerializeField] private AudioClip spinStartClip;

    [Tooltip("How far the spin loop's pitch bends down as a reel slows. 1 leaves it alone.")]
    [SerializeField, Range(0.25f, 1f)] private float spinPitchAtStop = 0.72f;

    public IReadOnlyList<SlotReelStrip> Reels { get { return reels; } }
    public int VisibleCells { get { return visibleCells; } }

    /// <summary>Clamped, so a config edited to more cells than it shows cannot break the win line.</summary>
    public int WinLineCell { get { return Mathf.Clamp(winLineCell, 0, Mathf.Max(0, visibleCells - 1)); } }

    public float SpinUpSeconds { get { return spinUpSeconds; } }
    public float StartStaggerSeconds { get { return startStaggerSeconds; } }
    public float SpinSeconds { get { return spinSeconds; } }
    public float CruiseCellsPerSecond { get { return cruiseCellsPerSecond; } }
    public float StopDelaySeconds { get { return stopDelaySeconds; } }
    public float ReelStopSeconds { get { return reelStopSeconds; } }
    public int FullTurnsBeforeStop { get { return fullTurnsBeforeStop; } }

    public AnimationCurve SpinUpCurve { get { return spinUpCurve; } }
    public AnimationCurve StopCurve { get { return stopCurve; } }
    public float BounceCells { get { return bounceCells; } }
    public float BounceSeconds { get { return bounceSeconds; } }
    public AnimationCurve BounceCurve { get { return bounceCurve; } }

    public SlotResultMode ResultMode { get { return resultMode; } set { resultMode = value; } }
    public bool UseFixedSeed { get { return useFixedSeed; } }
    public int RandomSeed { get { return randomSeed; } }
    public SlotPaytable Paytable { get { return paytable; } }

    public float WinHoldSeconds { get { return winHoldSeconds; } }
    public float LoseHoldSeconds { get { return loseHoldSeconds; } }
    public float CooldownSeconds { get { return cooldownSeconds; } }

    public float LogoPulseSeconds { get { return logoPulseSeconds; } }
    public float LogoPulseAmount { get { return logoPulseAmount; } }
    public float HorseshoeIdleGlow { get { return horseshoeIdleGlow; } }
    public float HorseshoePulseSeconds { get { return horseshoePulseSeconds; } }
    public float LightSweepIntervalSeconds { get { return lightSweepIntervalSeconds; } }
    public float LightSweepSeconds { get { return lightSweepSeconds; } }
    public float IdleDustRate { get { return idleDustRate; } }

    public float WinFlashSeconds { get { return winFlashSeconds; } }
    public float WinGlowPeak { get { return winGlowPeak; } }
    public float WinSymbolPunch { get { return winSymbolPunch; } }
    public int WinSweepCount { get { return winSweepCount; } }
    public int WinDustBurst { get { return winDustBurst; } }
    public float WinSparkleSeconds { get { return winSparkleSeconds; } }

    public Sprite WinFlashSprite { get { return winFlashSprite; } }
    public Sprite SparkleStarSprite { get { return sparkleStarSprite; } }
    public Sprite SparkleSoftSprite { get { return sparkleSoftSprite; } }
    public Sprite LightSweepSprite { get { return lightSweepSprite; } }

    public AudioClip SpinLoopClip { get { return spinLoopClip; } }
    public AudioClip ReelStopClip { get { return reelStopClip; } }
    public AudioClip WinClip { get { return winClip; } }
    public AudioClip LoseClip { get { return loseClip; } }
    public AudioClip SpinStartClip { get { return spinStartClip; } }
    public float SpinPitchAtStop { get { return spinPitchAtStop; } }

    /// <summary>The strip for one reel, or null when the config is short.</summary>
    public SlotReelStrip Reel(int index)
    {
        if (reels == null || index < 0 || index >= reels.Length)
        {
            return null;
        }

        return reels[index];
    }

    /// <summary>The Forced-mode result, with every position wrapped into its own strip.</summary>
    public SlotMachineResult BuildForcedResult()
    {
        var indices = new int[SlotMachineResult.ReelCount];
        for (int i = 0; i < indices.Length; i++)
        {
            int wanted = forcedItemIndices != null && i < forcedItemIndices.Length ? forcedItemIndices[i] : 0;
            var strip = Reel(i);
            indices[i] = strip == null ? 0 : strip.Wrap(wanted);
        }

        return SlotMachineResult.FromIndices(indices[0], indices[1], indices[2]);
    }

    /// <summary>Sets the Forced-mode positions, so a show or a test can aim the machine.</summary>
    public void SetForcedItemIndices(int left, int center, int right)
    {
        if (forcedItemIndices == null || forcedItemIndices.Length < SlotMachineResult.ReelCount)
        {
            forcedItemIndices = new int[SlotMachineResult.ReelCount];
        }

        forcedItemIndices[0] = left;
        forcedItemIndices[1] = center;
        forcedItemIndices[2] = right;
    }

    /// <summary>
    /// What is wrong with this config, or an empty list. Kept cheap and allocation-light so the
    /// inspector and <c>OnValidate</c> can both call it.
    /// </summary>
    public void CollectProblems(List<string> problems)
    {
        if (problems == null)
        {
            return;
        }

        if (reels == null || reels.Length != SlotMachineResult.ReelCount)
        {
            problems.Add("Reels must hold exactly " + SlotMachineResult.ReelCount + " strips.");
        }
        else
        {
            for (int i = 0; i < reels.Length; i++)
            {
                var strip = reels[i];
                if (strip == null || strip.Count == 0)
                {
                    problems.Add("Reel " + i + " has no positions.");
                    continue;
                }

                if (strip.Count < visibleCells)
                {
                    problems.Add("Reel " + i + " has " + strip.Count + " positions but " + visibleCells +
                                 " are visible, so the same one would appear twice at rest.");
                }

                if (strip.background == null)
                {
                    problems.Add("Reel " + i + " has no background sprite.");
                }

                for (int j = 0; j < strip.Count; j++)
                {
                    var item = strip.items[j];
                    if (item.kind == SlotReelItemKind.Symbol && item.sprite == null)
                    {
                        problems.Add("Reel " + i + " position " + j + " is a Symbol with no sprite.");
                    }
                }
            }
        }

        if (winLineCell < 0 || winLineCell >= visibleCells)
        {
            problems.Add("Win Line Cell " + winLineCell + " is outside the " + visibleCells + " visible positions.");
        }

        if (paytable == null)
        {
            problems.Add("No paytable, so every spin will read as a loss.");
        }

        if (bounceCells >= 0.5f)
        {
            problems.Add("Bounce Cells is at least half a position, which would change the item on the win line.");
        }
    }

    private void OnValidate()
    {
        // Cheap clamps only. Anything that needs to walk the strips lives in CollectProblems, which
        // the inspector calls on demand.
        if (reels != null && reels.Length != SlotMachineResult.ReelCount)
        {
            var resized = new SlotReelStrip[SlotMachineResult.ReelCount];
            for (int i = 0; i < resized.Length; i++)
            {
                resized[i] = i < reels.Length ? reels[i] : new SlotReelStrip();
            }

            reels = resized;
        }

        if (forcedItemIndices == null || forcedItemIndices.Length != SlotMachineResult.ReelCount)
        {
            var resized = new int[SlotMachineResult.ReelCount];
            for (int i = 0; i < resized.Length && forcedItemIndices != null && i < forcedItemIndices.Length; i++)
            {
                resized[i] = forcedItemIndices[i];
            }

            forcedItemIndices = resized;
        }

        winLineCell = Mathf.Clamp(winLineCell, 0, Mathf.Max(0, visibleCells - 1));
    }
}
