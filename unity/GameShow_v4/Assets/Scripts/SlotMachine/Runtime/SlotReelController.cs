using UnityEngine;

/// <summary>
/// One reel's motion. It owns the strip, the scroll position and the speed, and it knows how to
/// come to rest on an exact position without a visible jump.
///
/// It has no <c>Update</c> of its own. <see cref="SlotMachineController"/> ticks all three reels in
/// a known order, which keeps the three in step and makes the whole thing testable by handing it a
/// fixed time step instead of waiting for frames.
///
/// The landing is worked out once, when the stop is requested, and expressed as a distance rather
/// than a speed: the reel travels from where it is to an exact integer position, following
/// <see cref="SlotMachineConfig.StopCurve"/>. The distance is chosen so the curve's opening slope
/// matches the speed the reel already has, so there is no jolt when the stop begins, and it is then
/// raised to the next position whose remainder puts the wanted item on the win line. Because the
/// target is an integer the reel cannot drift, and because the bounce is under half a position the
/// item on the win line never changes after landing.
/// </summary>
[DisallowMultipleComponent]
public class SlotReelController : MonoBehaviour
{
    /// <summary>Where a reel is in its own spin.</summary>
    public enum ReelPhase
    {
        Idle,
        WaitingToStart,
        SpinningUp,
        Cruising,
        Stopping,
        Bouncing,
    }

    [Tooltip("The layers that draw this reel. Left empty, it is looked up on this object.")]
    [SerializeField] private SlotReelView view;

    [Tooltip("0 left, 1 center, 2 right. Sets which strip and which stop delay this reel uses.")]
    [SerializeField, Min(0)] private int reelIndex;

    private SlotMachineConfig _config;
    private SlotReelStrip _strip;

    private ReelPhase _phase = ReelPhase.Idle;
    private float _position;
    private float _speed;
    private float _timer;
    private float _startDelay;

    private float _stopFrom;
    private float _stopTo;
    private int _stopTargetIndex = -1;
    private bool _stopRequested;
    private int _pendingStopIndex;

    public int ReelIndex { get { return reelIndex; } set { reelIndex = value; } }
    public SlotReelView View { get { return view; } }
    public ReelPhase Phase { get { return _phase; } }

    /// <summary>True until the reel has fully settled, bounce included.</summary>
    public bool IsSpinning { get { return _phase != ReelPhase.Idle; } }

    /// <summary>True once this reel has been told where to land.</summary>
    public bool IsStopping { get { return _phase == ReelPhase.Stopping || _phase == ReelPhase.Bouncing; } }

    /// <summary>Scroll position in strip positions. Whole numbers are exact rest points.</summary>
    public float Position { get { return _position; } }

    /// <summary>Current speed in positions per second, which the audio uses to bend its pitch.</summary>
    public float Speed { get { return _speed; } }

    /// <summary>Strip position this reel was told to land on, or -1 before it has been told.</summary>
    public int StopTargetIndex { get { return IsStopping ? _stopTargetIndex : -1; } }

    /// <summary>How far the reel is through slowing down, 0-1. 0 at any other time.</summary>
    public float StopProgress
    {
        get
        {
            if (_phase != ReelPhase.Stopping || _config == null)
            {
                return _phase == ReelPhase.Bouncing ? 1f : 0f;
            }

            return Mathf.Clamp01(_timer / Mathf.Max(0.01f, _config.ReelStopSeconds));
        }
    }

    /// <summary>Strip position on the win line right now.</summary>
    public int WinLineItemIndex
    {
        get
        {
            if (_strip == null || _strip.Count == 0)
            {
                return 0;
            }

            return _strip.Wrap(Mathf.RoundToInt(_position) + _config.WinLineCell);
        }
    }

    /// <summary>The item on the win line right now, or null when the reel has no strip.</summary>
    public SlotReelItem WinLineItem
    {
        get
        {
            if (_strip == null || _strip.Count == 0)
            {
                return null;
            }

            return _strip[WinLineItemIndex];
        }
    }

    /// <summary>Binds the reel to a config and puts it at rest showing the strip's first positions.</summary>
    public void Initialize(SlotMachineConfig config, int index)
    {
        _config = config;
        reelIndex = index;
        _strip = config == null ? null : config.Reel(index);

        if (view == null)
        {
            view = GetComponent<SlotReelView>();
        }

        if (view != null)
        {
            view.Configure(config, _strip);
        }

        ResetReel();
    }

    /// <summary>Back to rest, at the position the cabinet reference paints.</summary>
    public void ResetReel()
    {
        _phase = ReelPhase.Idle;
        _position = 0f;
        _speed = 0f;
        _timer = 0f;
        _startDelay = 0f;
        _stopRequested = false;
        _pendingStopIndex = -1;
        if (view != null)
        {
            view.SetPunch(0f);
            view.SetWinHighlight(0f);
            view.SetScroll(_position);
        }
    }

    /// <summary>
    /// Starts turning after <paramref name="startDelay"/> seconds. The delay is what stops the three
    /// reels from moving as one block.
    /// </summary>
    public void BeginSpin(float startDelay)
    {
        _phase = startDelay > 0f ? ReelPhase.WaitingToStart : ReelPhase.SpinningUp;
        _startDelay = Mathf.Max(0f, startDelay);
        _timer = 0f;
        _speed = 0f;
        _stopRequested = false;
        _pendingStopIndex = -1;
        if (view != null)
        {
            view.SetPunch(0f);
            view.SetWinHighlight(0f);
        }
    }

    /// <summary>
    /// Tells the reel to come to rest with strip position <paramref name="targetItemIndex"/> on the
    /// win line. Safe to call before the reel has reached full speed: the stop is held until it has,
    /// so the landing distance is worked out from a speed the reel actually has.
    /// </summary>
    public void RequestStop(int targetItemIndex)
    {
        if (_strip == null || _strip.Count == 0 || _phase == ReelPhase.Idle)
        {
            return;
        }

        if (IsStopping)
        {
            return;
        }

        _pendingStopIndex = _strip.Wrap(targetItemIndex);
        _stopRequested = true;

        if (_phase == ReelPhase.Cruising)
        {
            BeginStop();
        }
    }

    /// <summary>
    /// Drops the reel straight onto a position with no motion, used by <c>CancelSpin(snap: true)</c>
    /// and by the editor preview.
    /// </summary>
    public void SnapTo(int itemIndex)
    {
        if (_strip == null || _strip.Count == 0)
        {
            return;
        }

        int wanted = _strip.Wrap(itemIndex);
        int count = _strip.Count;
        // position P puts strip position (P + winLineCell) mod count on the win line.
        int p = ((wanted - _config.WinLineCell) % count + count) % count;

        _phase = ReelPhase.Idle;
        _position = p;
        _speed = 0f;
        _timer = 0f;
        _stopRequested = false;
        _pendingStopIndex = -1;
        if (view != null)
        {
            view.SetScroll(_position);
        }
    }

    /// <summary>Advances the reel by <paramref name="deltaTime"/> seconds.</summary>
    public void Tick(float deltaTime)
    {
        if (_config == null || _strip == null || _strip.Count == 0)
        {
            return;
        }

        switch (_phase)
        {
            case ReelPhase.Idle:
                break;

            case ReelPhase.WaitingToStart:
                _timer += deltaTime;
                if (_timer >= _startDelay)
                {
                    _timer = 0f;
                    _phase = ReelPhase.SpinningUp;
                }

                break;

            case ReelPhase.SpinningUp:
            {
                _timer += deltaTime;
                float u = Mathf.Clamp01(_timer / _config.SpinUpSeconds);
                _speed = _config.CruiseCellsPerSecond * _config.SpinUpCurve.Evaluate(u);
                Advance(_speed * deltaTime);
                if (u >= 1f)
                {
                    _speed = _config.CruiseCellsPerSecond;
                    _phase = ReelPhase.Cruising;
                    _timer = 0f;
                    if (_stopRequested)
                    {
                        BeginStop();
                    }
                }

                break;
            }

            case ReelPhase.Cruising:
                _speed = _config.CruiseCellsPerSecond;
                Advance(_speed * deltaTime);
                break;

            case ReelPhase.Stopping:
            {
                _timer += deltaTime;
                float duration = Mathf.Max(0.01f, _config.ReelStopSeconds);
                float u = Mathf.Clamp01(_timer / duration);
                float previous = _position;
                _position = Mathf.LerpUnclamped(_stopFrom, _stopTo, _config.StopCurve.Evaluate(u));
                _speed = deltaTime > 0f ? (_position - previous) / deltaTime : 0f;
                if (u >= 1f)
                {
                    // Land exactly, so nothing accumulates over a show's worth of spins.
                    _position = _stopTo;
                    _speed = 0f;
                    _timer = 0f;
                    _phase = _config.BounceCells > 0f && _config.BounceSeconds > 0f
                        ? ReelPhase.Bouncing
                        : ReelPhase.Idle;
                }

                Redraw();
                break;
            }

            case ReelPhase.Bouncing:
            {
                _timer += deltaTime;
                float u = Mathf.Clamp01(_timer / _config.BounceSeconds);
                float offset = _config.BounceCurve.Evaluate(u) * _config.BounceCells;
                _position = _stopTo + offset;
                if (u >= 1f)
                {
                    _position = _stopTo;
                    _phase = ReelPhase.Idle;
                    _timer = 0f;
                }

                Redraw();
                break;
            }
        }
    }

    private void BeginStop()
    {
        int count = _strip.Count;
        var curve = _config.StopCurve;

        // The curve's opening slope decides how far the reel must travel for the stop to begin at
        // the speed it is already turning: distance = speed * duration / slope.
        const float h = 0.02f;
        float slope = Mathf.Max(0.2f, (curve.Evaluate(h) - curve.Evaluate(0f)) / h);
        float natural = _config.CruiseCellsPerSecond * _config.ReelStopSeconds / slope;
        float minimum = _position + natural + _config.FullTurnsBeforeStop * count;

        int wanted = ((_pendingStopIndex - _config.WinLineCell) % count + count) % count;
        int candidate = Mathf.CeilToInt(minimum);
        int remainder = ((candidate % count) + count) % count;
        candidate += ((wanted - remainder) % count + count) % count;

        _stopFrom = _position;
        _stopTo = candidate;
        _stopTargetIndex = _pendingStopIndex;
        _stopRequested = false;
        _timer = 0f;
        _phase = ReelPhase.Stopping;
    }

    /// <summary>Keeps <see cref="Position"/> small while cruising, which the ribbon makes invisible.</summary>
    private void Advance(float cells)
    {
        _position += cells;
        int count = _strip.Count;
        if (_position >= count)
        {
            _position -= count * Mathf.Floor(_position / count);
        }

        Redraw();
    }

    private void Redraw()
    {
        if (view != null)
        {
            view.SetScroll(_position);
        }
    }
}
