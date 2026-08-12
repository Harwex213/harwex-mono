using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Renders the stage the studio sends and reports the gated stages as done.
///
/// The studio owns the game flow. It sends one stage at a time over <see cref="WsConnection"/>,
/// and this component turns that stage into what the scene shows:
///
/// <list type="bullet">
/// <item>START and WAITING turn the hero wheel slowly. The studio's own timer advances them.</item>
/// <item>SPINNING spins the wheel onto the result in the payload, then reports done. In the dice
/// round it drops every die through the cabinet, both bays at once, and waits for them to
/// settle instead.</item>
/// <item>RESULT, SWITCH and CANCELING hold for their own time, then report done. A SWITCH also
/// moves the camera onto the round named in its uri, and is not reported done until it lands.</item>
/// </list>
///
/// The round in the uri picks what the camera watches: MAIN_* is shot on the hero wheel, and
/// BONUS_DICE_* on the acrylic cabinet. The three bonus rounds with no visual of their own still
/// stand in on the wheel.
///
/// Every stage and every transition is written to the console, prefixed with <c>[Show]</c>.
/// </summary>
[DisallowMultipleComponent]
public class ShowDirector : MonoBehaviour
{
    [Header("Wiring")]
    [Tooltip("The socket to the studio. Left empty, it is looked up on this object, then in the scene.")]
    [SerializeField] private WsConnection connection;

    [Tooltip("The hero wheel. Left empty, it is looked up in the scene.")]
    [SerializeField] private CrazyTimeWheel wheel;

    [Tooltip("The camera rig. Left empty, it is looked up in the scene. Without it the camera holds still.")]
    [SerializeField] private ShowCamera showCamera;

    [Tooltip("The dice cabinet. Left empty, it is looked up in the scene. Without it the dice round spins the wheel.")]
    [SerializeField] private DiceBoard diceBoard;

    [Header("Hold times")]
    [Tooltip("Seconds the win effects run before the studio is told the result is done.")]
    [SerializeField, Min(0f)] private float resultHoldSeconds = 2f;

    [Tooltip("Seconds the switch to another game takes.")]
    [SerializeField, Min(0f)] private float switchHoldSeconds = 1.5f;

    [Tooltip("Seconds the cancel effect takes.")]
    [SerializeField, Min(0f)] private float cancelHoldSeconds = 1f;

    [Tooltip(
        "Seconds a camera move is waited on before the stage carries on without it. Only a safety " +
        "net against a move that never lands, so keep it above the longest shot in ShowCamera - " +
        "the return to the wide pose is the slow one.")]
    [SerializeField, Min(0f)] private float cameraMoveTimeout = 8f;

    [Header("Bonus dice")]
    [Tooltip("Seconds the camera holds on the cabinet before the dice are released, so the drop is on screen.")]
    [SerializeField, Min(0f)] private float diceReleaseDelaySeconds = 0.9f;

    [Header("Wheel")]
    [Tooltip("Turn the wheel slowly during START and WAITING.")]
    [SerializeField] private bool idleBetweenSpins = true;

    [Tooltip(
        "Wheel label each MAIN result lands on, indexed by the result number the studio sends. " +
        "Results 0-5 stay in the main round, 6 opens LUCK, 7 DICE, 8 DELUXE and 9 SHOW.")]
    [SerializeField]
    private string[] mainResultLabels =
    {
        "1", "2", "5", "10", "1", "2",
        "BONUS LUCK", "BONUS DICE", "BONUS DELUXE", "GAME SHOW",
    };

    [Header("Logging")]
    [Tooltip("Seconds between the reminders of the stage on screen. Set to 0 to log the stage only when it starts.")]
    [SerializeField, Min(0f)] private float heartbeatSeconds;

    /// <summary>The stage on screen right now.</summary>
    public ShowStage CurrentStage { get; private set; }

    private Coroutine _render;
    private float _stageStartedAt;
    private float _nextHeartbeatAt;

    private void Awake()
    {
        if (connection == null)
        {
            connection = GetComponent<WsConnection>();
        }

        if (connection == null)
        {
            connection = FindFirstObjectByType<WsConnection>();
        }

        if (connection == null)
        {
            Debug.LogError("ShowDirector: no WsConnection in the scene. The show cannot start.", this);
            enabled = false;
            return;
        }

        if (wheel == null)
        {
            wheel = FindFirstObjectByType<CrazyTimeWheel>();
        }

        if (wheel == null)
        {
            Debug.LogWarning("ShowDirector: no CrazyTimeWheel in the scene. Spins are reported as done at once.", this);
        }

        if (showCamera == null)
        {
            showCamera = FindFirstObjectByType<ShowCamera>();
        }

        if (diceBoard == null)
        {
            diceBoard = FindFirstObjectByType<DiceBoard>();
        }

        if (diceBoard == null)
        {
            Debug.LogWarning(
                "ShowDirector: no DiceBoard in the scene. The dice round falls back to the hero wheel.",
                this);
        }
    }

    private void OnEnable()
    {
        if (connection != null)
        {
            connection.StageReceived += OnStageReceived;
        }
    }

    private void OnDisable()
    {
        if (connection != null)
        {
            connection.StageReceived -= OnStageReceived;
        }
    }

    private void Update()
    {
        if (heartbeatSeconds <= 0f || string.IsNullOrEmpty(CurrentStage.Uri) || Time.time < _nextHeartbeatAt)
        {
            return;
        }

        _nextHeartbeatAt = Time.time + heartbeatSeconds;
        Debug.Log($"[Show] rendering {CurrentStage} for {Time.time - _stageStartedAt:0.0}s", this);
    }

    private void OnStageReceived(WsConnectionMessage message)
    {
        var next = ShowStage.Parse(message.Uri);
        float held = Time.time - _stageStartedAt;

        Debug.Log($"[Show] {CurrentStage} -> {next} (previous stage held {held:0.00}s)", this);

        if (!next.IsKnown)
        {
            Debug.LogError(
                $"[Show] unknown stage '{message.Uri}'. Nothing is rendered and no done is sent, " +
                "so the studio waits if that stage was gated.",
                this);
            return;
        }

        // A stage that arrives mid-render replaces the one on screen. CANCELING arrives this way.
        if (_render != null)
        {
            StopCoroutine(_render);
            _render = null;
        }

        CurrentStage = next;
        _stageStartedAt = Time.time;
        _nextHeartbeatAt = Time.time + heartbeatSeconds;

        Debug.Log(
            $"[Show] rendering {next} | game={next.Game} phase={next.Phase} gated={next.IsGated} " +
            $"result={Describe(message.Payload)} correlationId={message.CorrelationId}",
            this);

        _render = StartCoroutine(RenderStage(next, message.Payload, message.CorrelationId));
    }

    private IEnumerator RenderStage(ShowStage stage, WsConnectionMessagePayload payload, string correlationId)
    {
        switch (stage.Phase)
        {
            case ShowPhase.Start:
            case ShowPhase.Waiting:
                // The studio's timer advances these two. Idle the wheel and wait for the next frame.
                SetIdleSpin(idleBetweenSpins);
                ClearDice();
                FrameWide(stage.Game);
                break;

            case ShowPhase.Spinning:
                // The camera moves in as the game starts, and settles well before it ends.
                FrameSpin(stage.Game);
                yield return PlaySpin(stage, payload);
                Report(stage, correlationId);
                break;

            case ShowPhase.Result:
                Debug.Log($"[Show] {stage} win effects for {resultHoldSeconds:0.#}s", this);
                FrameResult(stage.Game);
                yield return new WaitForSeconds(resultHoldSeconds);
                Report(stage, correlationId);
                break;

            case ShowPhase.Switch:
                // The uri names the round being switched into, so this is the move onto that
                // game: BONUS_DICE_SWITCH travels to the cabinet, MAIN_SWITCH back to the wheel.
                Debug.Log($"[Show] {stage} switching to {stage.Game} over at least {switchHoldSeconds:0.#}s", this);
                SetIdleSpin(idleBetweenSpins);
                ClearDice();
                FrameWide(stage.Game);
                yield return HoldForCamera(switchHoldSeconds);
                Report(stage, correlationId);
                break;

            case ShowPhase.Canceling:
                Debug.Log($"[Show] {stage} round cancelled, the wheel and the dice stop where they are", this);
                if (wheel != null)
                {
                    wheel.StopSpin();
                }

                if (diceBoard != null)
                {
                    diceBoard.StopRoll();
                }

                SetIdleSpin(false);
                FrameWide(stage.Game);
                yield return new WaitForSeconds(cancelHoldSeconds);
                Report(stage, correlationId);
                break;
        }

        _render = null;
    }

    /// <summary>Plays the round's own spin: the dice fall in the dice round, the wheel turns in the rest.</summary>
    private IEnumerator PlaySpin(ShowStage stage, WsConnectionMessagePayload payload)
    {
        if (stage.Game == ShowGame.BonusDice && diceBoard != null)
        {
            yield return RollDice(stage, payload);
            yield break;
        }

        yield return SpinWheel(stage, payload);
    }

    /// <summary>
    /// Drops every die through the cabinet, the pip dice down the wide bay and the colour dice
    /// down the narrow one, and waits for them all to come to rest. The faces are whatever the
    /// physics leaves on top; see <see cref="DiceBoard"/> for how a studio result would have to
    /// be honoured.
    /// </summary>
    private IEnumerator RollDice(ShowStage stage, WsConnectionMessagePayload payload)
    {
        // Give the camera its beat on the cabinet, or the release happens off screen.
        yield return HoldForCamera(diceReleaseDelaySeconds);

        diceBoard.Roll(payload == null ? null : payload.Result);

        while (diceBoard.IsRolling)
        {
            yield return null;
        }

        Debug.Log($"[Show] {stage} dice landed on {diceBoard.DescribeRoll()}", this);
    }

    /// <summary>Waits for the camera to reach its mark, then out to <paramref name="minimumSeconds"/>.</summary>
    private IEnumerator HoldForCamera(float minimumSeconds)
    {
        float started = Time.time;

        while (showCamera != null && showCamera.IsMoving && Time.time - started < cameraMoveTimeout)
        {
            yield return null;
        }

        float remaining = minimumSeconds - (Time.time - started);
        if (remaining > 0f)
        {
            yield return new WaitForSeconds(remaining);
        }
    }

    /// <summary>Takes the dice off the board, so the cabinet stands empty until the next drop.</summary>
    private void ClearDice()
    {
        if (diceBoard != null)
        {
            diceBoard.Park();
        }
    }

    /// <summary>Spins the hero wheel onto the segment the studio picked.</summary>
    private IEnumerator SpinWheel(ShowStage stage, WsConnectionMessagePayload payload)
    {
        if (wheel == null)
        {
            yield break;
        }

        if (stage.Game != ShowGame.Main)
        {
            Debug.Log($"[Show] {stage} has no bonus visual yet, the hero wheel stands in for it", this);
        }

        int segment = ResolveSegment(stage, payload);

        SetIdleSpin(false);
        Debug.Log($"[Show] {stage} spinning to segment {segment} ({CrazyTimeWheel.LabelOf(segment)})", this);

        wheel.SpinTo(segment);

        while (wheel.IsSpinning)
        {
            yield return null;
        }

        Debug.Log(
            $"[Show] {stage} wheel stopped on segment {wheel.CurrentSegment} " +
            $"({CrazyTimeWheel.LabelOf(wheel.CurrentSegment)})",
            this);
    }

    /// <summary>
    /// Turns the studio's result into a wheel segment. The result is either a face value that the
    /// rim carries, such as <c>10</c> or <c>COIN FLIP</c>, or a number 0-9 that
    /// <see cref="mainResultLabels"/> maps onto one.
    /// </summary>
    private int ResolveSegment(ShowStage stage, WsConnectionMessagePayload payload)
    {
        string result = payload == null ? null : payload.Result;

        if (string.IsNullOrEmpty(result))
        {
            int fallback = Random.Range(0, CrazyTimeWheel.SegmentCount);
            Debug.LogWarning(
                $"[Show] {stage} carries no result, the wheel stops on segment {fallback} " +
                $"({CrazyTimeWheel.LabelOf(fallback)}) instead",
                this);
            return fallback;
        }

        int segment = FindSegment(result);
        if (segment >= 0)
        {
            return segment;
        }

        int outcome;
        if (int.TryParse(result, out outcome) && outcome >= 0 && outcome < mainResultLabels.Length)
        {
            segment = FindSegment(mainResultLabels[outcome]);
            if (segment >= 0)
            {
                return segment;
            }

            Debug.LogWarning(
                $"[Show] result {outcome} maps to label '{mainResultLabels[outcome]}', " +
                "and the rim carries no such label. Check the mapping on ShowDirector.",
                this);
        }

        int random = Random.Range(0, CrazyTimeWheel.SegmentCount);
        Debug.LogWarning(
            $"[Show] {stage} sent result '{result}', which matches no segment. " +
            $"The wheel stops on segment {random} ({CrazyTimeWheel.LabelOf(random)}) instead.",
            this);
        return random;
    }

    /// <summary>
    /// Picks a segment that carries this label. Several segments share a label, so one of them is
    /// drawn at random and the wheel does not land on the same spot every time.
    /// </summary>
    private static int FindSegment(string label)
    {
        var matches = new List<int>();

        for (int i = 0; i < CrazyTimeWheel.SegmentCount; i++)
        {
            if (string.Equals(CrazyTimeWheel.LabelOf(i), label, System.StringComparison.OrdinalIgnoreCase))
            {
                matches.Add(i);
            }
        }

        return matches.Count == 0 ? -1 : matches[Random.Range(0, matches.Count)];
    }

    private void SetIdleSpin(bool idle)
    {
        if (wheel != null)
        {
            wheel.IdleSpin = idle;
        }
    }

    private void FrameWide(ShowGame game)
    {
        if (showCamera != null)
        {
            showCamera.FrameWide(game);
        }
    }

    private void FrameSpin(ShowGame game)
    {
        if (showCamera != null)
        {
            showCamera.FrameSpin(game);
        }
    }

    private void FrameResult(ShowGame game)
    {
        if (showCamera != null)
        {
            showCamera.FrameResult(game);
        }
    }

    private void Report(ShowStage stage, string correlationId)
    {
        if (!stage.IsGated)
        {
            return;
        }

        Debug.Log($"[Show] {stage} done after {Time.time - _stageStartedAt:0.00}s", this);
        connection.SendDone(stage.Uri, correlationId);
    }

    private static string Describe(WsConnectionMessagePayload payload)
    {
        if (payload == null)
        {
            return "<none>";
        }

        string result = string.IsNullOrEmpty(payload.Result) ? "<none>" : payload.Result;
        return payload.BonusSpin > 0 ? $"{result} bonusSpin={payload.BonusSpin}" : result;
    }
}
