using System.Collections;
using UnityEngine;

/// <summary>
/// Drives the show from a panel on screen, with no studio behind it.
///
/// The panel takes the place of the studio. It holds <see cref="WsConnection"/> offline, so nothing
/// is dialled and no done leaves the app, and it feeds stage frames straight to the subscribers
/// through <see cref="WsConnection.InjectStage"/>. <see cref="ShowDirector"/> cannot tell the
/// difference, so every <see cref="ShowGame"/> and every <see cref="ShowPhase"/> can be rendered on
/// their own.
///
/// The panel offers three ways in:
///
/// <list type="bullet">
/// <item>One stage at a time, picked as a round and a phase, with a result in the payload.</item>
/// <item>A whole round, held on the ungated stages and advanced on each done.</item>
/// <item>A raw uri, for the stages the app is meant to reject.</item>
/// </list>
///
/// Press <see cref="toggleKey"/> to show and hide the panel. The key is read from the IMGUI event,
/// so it works while the project runs on the new input system alone.
/// </summary>
[DisallowMultipleComponent]
public class ShowDirectorDebug : MonoBehaviour
{
    /// <summary>
    /// Tells the panel window apart from any other IMGUI window. One panel runs at a time, so a
    /// fixed number is enough.
    /// </summary>
    private const int WindowId = 748301;

    /// <summary>Points the window keeps clear for its border and its vertical scrollbar.</summary>
    private const float ScrollbarAllowance = 42f;

    /// <summary>The rounds the studio can open, in the order the panel lists them.</summary>
    private static readonly ShowGame[] Games =
    {
        ShowGame.Main,
        ShowGame.BonusLuck,
        ShowGame.BonusDice,
        ShowGame.BonusDeluxe,
        ShowGame.BonusShow,
    };

    /// <summary>The uri prefix of each round in <see cref="Games"/>.</summary>
    private static readonly string[] GamePrefixes =
    {
        "MAIN", "BONUS_LUCK", "BONUS_DICE", "BONUS_DELUXE", "BONUS_SHOW",
    };

    private static readonly string[] GameButtons = { "MAIN", "LUCK", "DICE", "DELUXE", "SHOW" };

    /// <summary>The phases inside a round, in the order they run.</summary>
    private static readonly ShowPhase[] Phases =
    {
        ShowPhase.Start,
        ShowPhase.Waiting,
        ShowPhase.Spinning,
        ShowPhase.Result,
        ShowPhase.Switch,
        ShowPhase.Canceling,
    };

    /// <summary>The uri suffix of each phase in <see cref="Phases"/>.</summary>
    private static readonly string[] PhaseNames =
    {
        "START", "WAITING", "SPINNING", "RESULT", "SWITCH", "CANCELING",
    };

    private static readonly string[] PhaseButtons = { "START", "WAIT", "SPIN", "RESULT", "SWITCH", "CANCEL" };

    /// <summary>Results the rim carries. The panel sends them as one-click payloads.</summary>
    private static readonly string[] ResultPicks =
    {
        "1", "2", "5", "10", "GAME SHOW", "BONUS LUCK", "BONUS DICE", "BONUS DELUXE",
    };

    /// <summary>
    /// The button of each pick in <see cref="ResultPicks"/>. A button carries no more text than it
    /// has to, because the widest row sets the width of the whole panel.
    /// </summary>
    private static readonly string[] ResultButtons =
    {
        "1", "2", "5", "10", "SHOW", "LUCK", "DICE", "DELUXE",
    };

    [Header("Wiring")]
    [Tooltip("The socket to the studio. Left empty, it is looked up on this object, then in the scene.")]
    [SerializeField] private WsConnection connection;

    [Tooltip("The director under test. Left empty, it is looked up in the scene. Only its readout is used.")]
    [SerializeField] private ShowDirector director;

    [Tooltip("The hero wheel. Left empty, it is looked up in the scene. Only its readout is used.")]
    [SerializeField] private CrazyTimeWheel wheel;

    [Tooltip("The camera rig. Left empty, it is looked up in the scene. Only its readout is used.")]
    [SerializeField] private ShowCamera showCamera;

    [Tooltip("The dice cabinet. Left empty, it is looked up in the scene. Only its readout is used.")]
    [SerializeField] private DiceBoard diceBoard;

    [Header("Connection")]
    [Tooltip("Hold the socket shut and drive the show from this panel alone.")]
    [SerializeField] private bool mockConnection = true;

    [Header("Panel")]
    [Tooltip("Show the panel. The toggle key shows and hides it while the game runs.")]
    [SerializeField] private bool panelVisible = true;

    [Tooltip("Shows and hides the panel.")]
    [SerializeField] private KeyCode toggleKey = KeyCode.F1;

    [Tooltip("Size of the panel text and controls. Raise it on a high resolution game view.")]
    [SerializeField, Min(0.5f)] private float uiScale = 1f;

    [Tooltip("Where the panel sits, in unscaled points. Drag its title bar to move it.")]
    [SerializeField] private Rect panelRect = new(16f, 16f, 440f, 560f);

    [Header("Round")]
    [Tooltip("Seconds a played round holds START and WAITING. The studio's own timer times these two.")]
    [SerializeField, Min(0.1f)] private float autoHoldSeconds = 2f;

    [Tooltip("Seconds a played round waits for a done before it gives up and stops.")]
    [SerializeField, Min(1f)] private float doneTimeoutSeconds = 30f;

    /// <summary>The round picked in the panel.</summary>
    private ShowGame _game = ShowGame.Main;

    /// <summary>The phase picked in the panel.</summary>
    private ShowPhase _phase = ShowPhase.Start;

    private string _result = string.Empty;
    private string _bonusSpin = "0";
    private string _rawUri = "MAIN_SPINNING";

    /// <summary>Counts the frames this panel has sent. It makes each correlation id its own.</summary>
    private int _sent;

    private string _lastDone = "<none>";
    private float _stageStartedAt;
    private Vector2 _scroll;
    private GUIStyle _richLabel;
    private GUIStyle _wrapLabel;

    private Coroutine _round;

    /// <summary>The stage the played round waits on, and whether its done has arrived.</summary>
    private string _awaitedUri;

    private bool _doneArrived;

    /// <summary>Set when a played round gives up. Every step of that round then stops.</summary>
    private bool _roundAborted;

    private void Awake()
    {
        if (connection == null)
        {
            connection = GetComponent<WsConnection>();
        }

        if (connection == null)
        {
            connection = FindAnyObjectByType<WsConnection>();
        }

        if (connection == null)
        {
            Debug.LogError("ShowDirectorDebug: no WsConnection in the scene. There is nothing to drive.", this);
            enabled = false;
            return;
        }

        if (director == null)
        {
            director = FindAnyObjectByType<ShowDirector>();
        }

        if (wheel == null)
        {
            wheel = FindAnyObjectByType<CrazyTimeWheel>();
        }

        if (showCamera == null)
        {
            showCamera = FindAnyObjectByType<ShowCamera>();
        }

        if (diceBoard == null)
        {
            diceBoard = FindAnyObjectByType<DiceBoard>();
        }

        // Awake runs before the socket opens in Start, so nothing is dialled at all.
        connection.Offline = mockConnection;
    }

    private void OnEnable()
    {
        if (connection == null)
        {
            return;
        }

        connection.StageReceived += OnStageReceived;
        connection.DoneSent += OnDoneSent;
    }

    private void OnDisable()
    {
        if (connection != null)
        {
            connection.StageReceived -= OnStageReceived;
            connection.DoneSent -= OnDoneSent;
        }

        StopRound();
    }

    private void OnStageReceived(WsConnectionMessage message)
    {
        _stageStartedAt = Time.time;
    }

    private void OnDoneSent(WsConnectionResponse response)
    {
        _lastDone = $"{response.Uri} ({response.CorrelationId})";

        // This runs inside the director's own render coroutine. The played round only raises a flag
        // here and sends the next stage a frame later, so the render it interrupts is the finished
        // one and not the one that is still reporting.
        if (_awaitedUri == response.Uri)
        {
            _doneArrived = true;
        }
    }

    // ---------------------------------------------------------------- sending

    /// <summary>The uri of a stage, such as <c>BONUS_LUCK_SPINNING</c>.</summary>
    private static string UriFor(ShowGame game, ShowPhase phase)
    {
        return $"{GamePrefixes[IndexOf(game)]}_{PhaseNames[IndexOf(phase)]}";
    }

    private static int IndexOf(ShowGame game)
    {
        for (int i = 0; i < Games.Length; i++)
        {
            if (Games[i] == game)
            {
                return i;
            }
        }

        return 0;
    }

    private static int IndexOf(ShowPhase phase)
    {
        for (int i = 0; i < Phases.Length; i++)
        {
            if (Phases[i] == phase)
            {
                return i;
            }
        }

        return 0;
    }

    /// <summary>Sends a stage of a round, with a result in the payload.</summary>
    private void Send(ShowGame game, ShowPhase phase, string result, int bonusSpin)
    {
        string uri = UriFor(game, phase);

        // The uri is built here and read apart in ShowStage. A rename on one side has to reach the
        // other, so the round trip is checked rather than trusted.
        var parsed = ShowStage.Parse(uri);
        if (parsed.Game != game || parsed.Phase != phase)
        {
            Debug.LogError(
                $"[Debug] '{uri}' reads back as {parsed.Game}/{parsed.Phase}, not {game}/{phase}. " +
                "The uri names in ShowDirectorDebug and ShowStage have drifted apart.",
                this);
        }

        SendUri(uri, result, bonusSpin);
    }

    /// <summary>Sends a raw uri, whether the app knows that stage or not.</summary>
    private void SendUri(string uri, string result, int bonusSpin)
    {
        if (string.IsNullOrEmpty(uri))
        {
            Debug.LogWarning("[Debug] nothing to send, the uri is empty", this);
            return;
        }

        _sent++;

        var message = new WsConnectionMessage
        {
            Uri = uri,
            CorrelationId = $"debug-{_sent}",
        };

        if (!string.IsNullOrEmpty(result) || bonusSpin > 0)
        {
            message.Payload = new WsConnectionMessagePayload
            {
                Result = result,
                BonusSpin = bonusSpin,
            };
        }

        connection.InjectStage(message);
    }

    private int ParsedBonusSpin()
    {
        int value;
        return int.TryParse(_bonusSpin, out value) && value > 0 ? value : 0;
    }

    // ----------------------------------------------------------------- rounds

    /// <summary>
    /// Sends one stage, the way the send button does. A test or another tool can drive the show
    /// through this without the panel on screen.
    /// </summary>
    public void SendStage(ShowGame game, ShowPhase phase, string result)
    {
        Send(game, phase, result, 0);
    }

    /// <summary>Plays one main round, and the bonus round its result opens.</summary>
    [ContextMenu("Play one round")]
    public void PlayOneRound()
    {
        StartRound(OneRound());
    }

    /// <summary>Plays rounds one after another until <see cref="StopPlaying"/> is called.</summary>
    [ContextMenu("Loop rounds")]
    public void PlayRoundsUntilStopped()
    {
        StartRound(RoundAfterRound());
    }

    /// <summary>Abandons the round being played. The stage on screen stays as it is.</summary>
    [ContextMenu("Stop playing")]
    public void StopPlaying()
    {
        StopRound();
    }

    /// <summary>True while a round is being played.</summary>
    public bool IsPlaying
    {
        get { return _round != null; }
    }

    /// <summary>
    /// The result the panel puts in the payload. A played round lands on it every spin. Left empty,
    /// each spin picks a label off the rim instead.
    /// </summary>
    public string Result
    {
        get { return _result; }
        set { _result = value ?? string.Empty; }
    }

    private IEnumerator RoundAfterRound()
    {
        while (!_roundAborted)
        {
            yield return RunRound(ShowGame.Main);
        }

        _round = null;
    }

    private IEnumerator OneRound()
    {
        yield return RunRound(ShowGame.Main);
        _round = null;
    }

    /// <summary>
    /// Plays a round the way the studio runs it. START and WAITING are held for their own time, and
    /// SPINNING, RESULT and SWITCH each wait for the app to report them as done.
    /// </summary>
    private IEnumerator RunRound(ShowGame game)
    {
        yield return Hold(game, ShowPhase.Start);
        yield return Hold(game, ShowPhase.Waiting);

        string result = PickResult(game);
        yield return WaitForDone(game, ShowPhase.Spinning, result);
        yield return WaitForDone(game, ShowPhase.Result, result);

        ShowGame bonus = BonusFor(result);
        if (game == ShowGame.Main && bonus != ShowGame.Unknown)
        {
            // The main round hands over to the bonus round, and the bonus round hands back.
            yield return WaitForDone(game, ShowPhase.Switch, null);
            yield return RunRound(bonus);
            yield return WaitForDone(bonus, ShowPhase.Switch, null);
        }
    }

    /// <summary>Sends an ungated stage and holds it, the way the studio's timer holds it.</summary>
    private IEnumerator Hold(ShowGame game, ShowPhase phase)
    {
        if (_roundAborted)
        {
            yield break;
        }

        Send(game, phase, null, 0);
        yield return new WaitForSeconds(autoHoldSeconds);
    }

    /// <summary>Sends a gated stage and waits for the app to report it as done.</summary>
    private IEnumerator WaitForDone(ShowGame game, ShowPhase phase, string result)
    {
        if (_roundAborted)
        {
            yield break;
        }

        string uri = UriFor(game, phase);
        _awaitedUri = uri;
        _doneArrived = false;

        Send(game, phase, result, 0);

        float giveUpAt = Time.time + doneTimeoutSeconds;
        while (!_doneArrived)
        {
            if (Time.time > giveUpAt)
            {
                Debug.LogError(
                    $"[Debug] no done for {uri} in {doneTimeoutSeconds:0}s. The round is stopped.",
                    this);
                _roundAborted = true;
                _awaitedUri = null;
                yield break;
            }

            yield return null;
        }

        _awaitedUri = null;

        // The done was raised inside the director's render coroutine. Let that coroutine finish
        // before the next stage replaces it.
        yield return null;
    }

    /// <summary>The result a played round lands on. The panel's own result wins if one is typed.</summary>
    private string PickResult(ShowGame game)
    {
        if (!string.IsNullOrEmpty(_result))
        {
            return _result;
        }

        // A bonus round has no visual of its own yet, so the hero wheel stands in for it. Keep it
        // off the bonus segments there, or a bonus round would open another one.
        for (int attempt = 0; attempt < 32; attempt++)
        {
            string label = CrazyTimeWheel.LabelOf(Random.Range(0, CrazyTimeWheel.SegmentCount));
            if (game == ShowGame.Main || BonusFor(label) == ShowGame.Unknown)
            {
                return label;
            }
        }

        return "1";
    }

    /// <summary>The bonus round a result opens, or <see cref="ShowGame.Unknown"/> for a payout.</summary>
    private static ShowGame BonusFor(string result)
    {
        switch (result)
        {
            case "BONUS LUCK": return ShowGame.BonusLuck;
            case "BONUS DICE": return ShowGame.BonusDice;
            case "BONUS DELUXE": return ShowGame.BonusDeluxe;
            case "GAME SHOW": return ShowGame.BonusShow;
            default: return ShowGame.Unknown;
        }
    }

    private void StartRound(IEnumerator round)
    {
        StopRound();
        _roundAborted = false;
        _round = StartCoroutine(round);
    }

    private void StopRound()
    {
        _roundAborted = true;
        _awaitedUri = null;

        if (_round != null)
        {
            StopCoroutine(_round);
            _round = null;
        }
    }

    // -------------------------------------------------------------------- ui

    private void OnGUI()
    {
        ReadToggleKey();

        if (!panelVisible)
        {
            return;
        }

        Matrix4x4 restore = GUI.matrix;
        GUI.matrix = Matrix4x4.TRS(Vector3.zero, Quaternion.identity, Vector3.one * uiScale);

        panelRect = GUI.Window(WindowId, panelRect, DrawPanel, "Show debug");

        GUI.matrix = restore;
    }

    /// <summary>
    /// Reads the toggle key off the IMGUI event. The project runs on the new input system alone, so
    /// the old Input class throws, and this event arrives whichever backend is on.
    /// </summary>
    private void ReadToggleKey()
    {
        Event e = Event.current;
        if (e != null && e.type == EventType.KeyDown && e.keyCode == toggleKey)
        {
            panelVisible = !panelVisible;
            e.Use();
        }
    }

    private void DrawPanel(int windowId)
    {
        // The vertical scrollbar takes its width out of the view, and a row laid out before it
        // appears then runs off the right edge. The rows are given the narrower width up front, and
        // the horizontal scrollbar is left out for good.
        _scroll = GUILayout.BeginScrollView(_scroll, false, false, GUIStyle.none, GUI.skin.verticalScrollbar);
        GUILayout.BeginVertical(GUILayout.Width(panelRect.width - ScrollbarAllowance));

        DrawStatus();
        DrawConnection();
        DrawStage();
        DrawRound();
        DrawRaw();

        GUILayout.EndVertical();
        GUILayout.EndScrollView();

        GUI.DragWindow(new Rect(0f, 0f, panelRect.width, 20f));
    }

    private void DrawStatus()
    {
        GUILayout.Label("<b>Status</b>", RichLabel());

        ShowStage stage = director != null ? director.CurrentStage : default;

        if (string.IsNullOrEmpty(stage.Uri))
        {
            GUILayout.Label("stage: <none> yet", WrapLabel());
        }
        else
        {
            GUILayout.Label(
                $"stage: {stage} for {Time.time - _stageStartedAt:0.0}s ({(stage.IsGated ? "gated" : "ungated")})",
                WrapLabel());
        }

        if (wheel != null)
        {
            string spinning = wheel.IsSpinning ? "spinning" : "still";
            GUILayout.Label(
                $"wheel: {spinning}, segment {wheel.CurrentSegment} ({CrazyTimeWheel.LabelOf(wheel.CurrentSegment)})",
                WrapLabel());
        }

        if (diceBoard != null)
        {
            string rolling = diceBoard.IsRolling ? "falling" : "at rest";
            GUILayout.Label($"dice: {rolling}, {diceBoard.DescribeRoll()}", WrapLabel());
        }

        if (showCamera != null)
        {
            GUILayout.Label($"camera: {showCamera.CurrentShot}", WrapLabel());
        }

        GUILayout.Label($"last done: {_lastDone}", WrapLabel());
        GUILayout.Space(6f);
    }

    private void DrawConnection()
    {
        GUILayout.Label("<b>Connection</b>", RichLabel());

        bool mock = GUILayout.Toggle(mockConnection, " mock the studio (socket stays shut)");
        if (mock != mockConnection)
        {
            mockConnection = mock;
            connection.Offline = mock;

            if (!mock)
            {
                // The studio owns the flow again, so a played round would fight it.
                StopRound();
            }
        }

        GUILayout.Label(connection.IsConnected ? "socket: open" : "socket: closed", WrapLabel());
        GUILayout.Space(6f);
    }

    private void DrawStage()
    {
        GUILayout.Label("<b>Send one stage</b>", RichLabel());

        _game = Games[GUILayout.SelectionGrid(IndexOf(_game), GameButtons, GameButtons.Length)];
        _phase = Phases[GUILayout.SelectionGrid(IndexOf(_phase), PhaseButtons, 3)];

        GUILayout.BeginHorizontal();
        GUILayout.Label("result", GUILayout.Width(54f));
        _result = GUILayout.TextField(_result);
        GUILayout.Label("spin", GUILayout.Width(34f));
        _bonusSpin = GUILayout.TextField(_bonusSpin, GUILayout.Width(40f));
        GUILayout.EndHorizontal();

        int pick = GUILayout.SelectionGrid(-1, ResultButtons, 4);
        if (pick >= 0)
        {
            _result = ResultPicks[pick];
        }

        GUILayout.BeginHorizontal();
        if (GUILayout.Button($"send {UriFor(_game, _phase)}"))
        {
            Send(_game, _phase, _result, ParsedBonusSpin());
        }

        if (GUILayout.Button("clear result", GUILayout.Width(96f)))
        {
            _result = string.Empty;
            _bonusSpin = "0";
        }

        GUILayout.EndHorizontal();
        GUILayout.Space(6f);
    }

    private void DrawRound()
    {
        GUILayout.Label("<b>Play a round</b>", RichLabel());
        GUILayout.Label(
            _round == null
                ? "idle. A round holds START and WAITING, then waits for each done."
                : $"running. waiting on {(_awaitedUri ?? "a hold")}.",
            WrapLabel());

        GUILayout.BeginHorizontal();

        GUI.enabled = _round == null;
        if (GUILayout.Button("one round"))
        {
            PlayOneRound();
        }

        if (GUILayout.Button("loop rounds"))
        {
            PlayRoundsUntilStopped();
        }

        GUI.enabled = _round != null;
        if (GUILayout.Button("stop", GUILayout.Width(60f)))
        {
            StopPlaying();
        }

        GUI.enabled = true;
        GUILayout.EndHorizontal();

        if (GUILayout.Button($"cancel the round ({UriFor(_game, ShowPhase.Canceling)})"))
        {
            StopPlaying();
            Send(_game, ShowPhase.Canceling, null, 0);
        }

        GUILayout.Space(6f);
    }

    private void DrawRaw()
    {
        GUILayout.Label("<b>Send a raw uri</b>", RichLabel());

        GUILayout.BeginHorizontal();
        _rawUri = GUILayout.TextField(_rawUri);

        if (GUILayout.Button("send", GUILayout.Width(60f)))
        {
            SendUri(_rawUri, _result, ParsedBonusSpin());
        }

        GUILayout.EndHorizontal();
    }

    /// <summary>
    /// A label style that reads the bold tags in the section headings. It is built once, on the
    /// first frame the panel draws, because GUI.skin only holds a skin inside OnGUI.
    /// </summary>
    private GUIStyle RichLabel()
    {
        if (_richLabel == null)
        {
            _richLabel = new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true };
        }

        return _richLabel;
    }

    /// <summary>
    /// A label style that wraps. A label holds its line on one row otherwise, and a long stage name
    /// would then push every row of the panel out past its right edge.
    /// </summary>
    private GUIStyle WrapLabel()
    {
        if (_wrapLabel == null)
        {
            _wrapLabel = new GUIStyle(GUI.skin.label) { wordWrap = true };
        }

        return _wrapLabel;
    }
}
