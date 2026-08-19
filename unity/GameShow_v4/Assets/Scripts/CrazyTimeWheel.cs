using System;
using System.Collections;
using UnityEngine;

/// <summary>
/// Drives the Crazy Time prize wheel imported from CrazyTime_Wheel.fbx.
///
/// Only the <c>CT_WheelSpin</c> child rotates; the stand, mast, flapper and bulbs sit under
/// <c>CT_Root</c> and stay put. <c>CT_WheelSpin</c> turns about its own local Y axis, which
/// points away from the player, so a rising angle reads as clockwise from the front.
///
/// The rim carries 54 equal segments. Segment 0 (CRAZY TIME) is centred on the top flapper
/// when the local angle is 0, and segment <c>i</c> is centred there at <c>i * 360 / 54</c>.
/// </summary>
[DisallowMultipleComponent]
public class CrazyTimeWheel : MonoBehaviour
{
    public const int SegmentCount = 54;
    public const float DegreesPerSegment = 360f / SegmentCount;

    /// <summary>
    /// Face value of each segment, indexed by segment number. The names are the ones printed on
    /// the rim, and the four bonus names are the four bonus rounds the studio can open.
    /// </summary>
    private static readonly string[] SegmentLabels =
    {
        "GAME SHOW", "1", "2", "1", "5", "1",
        "BONUS DELUXE", "2", "1", "10", "1", "2",
        "BONUS DICE", "1", "5", "1", "2", "1",
        "BONUS LUCK", "10", "1", "2", "1", "5",
        "BONUS DICE", "1", "2", "1", "10", "1",
        "BONUS DELUXE", "2", "1", "5", "1", "2",
        "BONUS DICE", "1", "10", "1", "2", "1",
        "BONUS LUCK", "5", "1", "2", "1", "2",
        "BONUS DICE", "1", "2", "5", "2", "5",
    };

    [Header("Rig")]
    [Tooltip("The CT_WheelSpin transform. Left empty, it is looked up by name under this object.")]
    [SerializeField] private Transform wheel;

    [Tooltip("Rotation axis in the wheel's local space. CT_WheelSpin spins about its local Y.")]
    [SerializeField] private Vector3 spinAxis = Vector3.up;

    [Tooltip("Angle of the winning position, if the flapper is not at the top of the wheel.")]
    [SerializeField] private float pointerOffsetDegrees;

    [Header("Spin")]
    [Tooltip("Seconds from release to full stop.")]
    [SerializeField, Min(0.1f)] private float spinDuration = 7f;

    [Tooltip("Whole turns added on top of the travel to the winning segment.")]
    [SerializeField, Min(0f)] private float extraTurns = 4f;

    [Tooltip("Clockwise as seen by a player standing in front of the wheel.")]
    [SerializeField] private bool clockwise = true;

    [Tooltip("Progress of the spin over its duration. Ends flat so the wheel eases to a stop.")]
    [SerializeField] private AnimationCurve spinEasing = BuildDefaultEasing();

    [Header("Settle")]
    [Tooltip("Degrees the wheel rocks back after it lands. Set to 0 to stop dead.")]
    [SerializeField, Min(0f)] private float settleAmplitudeDegrees = 1.6f;

    [SerializeField, Min(0f)] private float settleDuration = 0.9f;

    [Header("Idle")]
    [Tooltip("Turn the wheel slowly while no spin is running.")]
    [SerializeField] private bool idleSpin;

    [SerializeField] private float idleDegreesPerSecond = 8f;

    /// <summary>Continuous angle in degrees; keeps counting up across turns.</summary>
    private float angle;

    private Coroutine spinRoutine;

    /// <summary>True from the moment a spin starts until the wheel has settled.</summary>
    public bool IsSpinning { get; private set; }

    /// <summary>Turns the wheel slowly while no spin is running.</summary>
    public bool IdleSpin
    {
        get { return idleSpin; }
        set { idleSpin = value; }
    }

    /// <summary>Raised with the winning segment index once the wheel has settled.</summary>
    public event Action<int> SpinCompleted;

    /// <summary>The segment currently under the flapper.</summary>
    public int CurrentSegment
    {
        get
        {
            // Which segment sits at the flapper depends on the angle alone, not on spin direction.
            int index = Mathf.RoundToInt((angle - pointerOffsetDegrees) / DegreesPerSegment) % SegmentCount;
            return index < 0 ? index + SegmentCount : index;
        }
    }

    /// <summary>The face value of a segment, e.g. "10" or "PACHINKO".</summary>
    public static string LabelOf(int segmentIndex)
    {
        int index = ((segmentIndex % SegmentCount) + SegmentCount) % SegmentCount;
        return SegmentLabels[index];
    }

    /// <summary>The wheel angle that centres a segment on the flapper.</summary>
    public float AngleForSegment(int segmentIndex)
    {
        return segmentIndex * DegreesPerSegment + pointerOffsetDegrees;
    }

    private void Reset()
    {
        wheel = ResolveWheel();
        spinEasing = BuildDefaultEasing();
    }

    private void Awake()
    {
        if (wheel == null)
        {
            wheel = ResolveWheel();
        }

        if (wheel == null)
        {
            Debug.LogError("CrazyTimeWheel: no CT_WheelSpin transform found under " + name, this);
            enabled = false;
            return;
        }

        // Start from whatever angle the model was authored at, so nothing snaps on load.
        angle = SignedAngleOnAxis(wheel.localRotation);
    }

    private void Update()
    {
        if (IsSpinning || !idleSpin || wheel == null)
        {
            return;
        }

        Apply(angle + idleDegreesPerSecond * Time.deltaTime * (clockwise ? 1f : -1f));
    }

    /// <summary>Spins to a segment picked at random with <see cref="UnityEngine.Random"/>.</summary>
    [ContextMenu("Spin (random segment)")]
    public void Spin()
    {
        SpinTo(UnityEngine.Random.Range(0, SegmentCount));
    }

    /// <summary>Spins to <paramref name="segmentIndex"/> using the serialised duration and turns.</summary>
    public void SpinTo(int segmentIndex)
    {
        SpinTo(segmentIndex, spinDuration, extraTurns);
    }

    /// <summary>Spins to <paramref name="segmentIndex"/>, overriding duration and turn count.</summary>
    public void SpinTo(int segmentIndex, float duration, float turns)
    {
        if (wheel == null)
        {
            Debug.LogError("CrazyTimeWheel: cannot spin without a wheel transform.", this);
            return;
        }

        int target = ((segmentIndex % SegmentCount) + SegmentCount) % SegmentCount;

        if (spinRoutine != null)
        {
            StopCoroutine(spinRoutine);
        }

        spinRoutine = StartCoroutine(SpinRoutine(target, Mathf.Max(0.01f, duration), Mathf.Max(0f, turns)));
    }

    /// <summary>Places a segment under the flapper immediately, with no animation.</summary>
    public void SetSegmentImmediate(int segmentIndex)
    {
        if (wheel == null)
        {
            return;
        }

        StopSpin();
        Apply(AngleForSegment(((segmentIndex % SegmentCount) + SegmentCount) % SegmentCount));
    }

    /// <summary>Abandons a running spin and leaves the wheel where it is.</summary>
    public void StopSpin()
    {
        if (spinRoutine != null)
        {
            StopCoroutine(spinRoutine);
            spinRoutine = null;
        }

        IsSpinning = false;
    }

    private IEnumerator SpinRoutine(int target, float duration, float turns)
    {
        IsSpinning = true;

        float direction = clockwise ? 1f : -1f;
        float start = angle;

        // Shortest travel to the target angle in the spin direction, then whole turns on top.
        float landing = AngleForSegment(target);
        float remainder = Mathf.Repeat((landing - start) * direction, 360f);
        float sweep = (remainder + turns * 360f) * direction;
        float end = start + sweep;

        float elapsed = 0f;
        while (elapsed < duration)
        {
            elapsed += Time.deltaTime;
            float t = Mathf.Clamp01(elapsed / duration);
            Apply(start + sweep * spinEasing.Evaluate(t));
            yield return null;
        }

        Apply(end);

        if (settleAmplitudeDegrees > 0f && settleDuration > 0f)
        {
            yield return Settle(end, direction);
        }

        Apply(end);

        IsSpinning = false;
        spinRoutine = null;

        var handler = SpinCompleted;
        if (handler != null)
        {
            handler(target);
        }
    }

    /// <summary>Rocks the wheel back and forth around its landing angle, damped to nothing.</summary>
    private IEnumerator Settle(float landingAngle, float direction)
    {
        const float oscillations = 1.75f;
        float elapsed = 0f;
        while (elapsed < settleDuration)
        {
            elapsed += Time.deltaTime;
            float t = Mathf.Clamp01(elapsed / settleDuration);
            float decay = (1f - t) * (1f - t);
            float offset = Mathf.Sin(t * oscillations * 2f * Mathf.PI) * settleAmplitudeDegrees * decay;
            Apply(landingAngle - offset * direction);
            yield return null;
        }
    }

    private void Apply(float newAngle)
    {
        angle = newAngle;
        wheel.localRotation = Quaternion.AngleAxis(angle, spinAxis.normalized);
    }

    /// <summary>Reads a rotation back as a signed angle about <see cref="spinAxis"/>.</summary>
    private float SignedAngleOnAxis(Quaternion rotation)
    {
        Vector3 axis = spinAxis.normalized;
        Vector3 reference = Vector3.Cross(axis, Mathf.Abs(axis.y) > 0.9f ? Vector3.forward : Vector3.up).normalized;
        Vector3 turned = rotation * reference;
        return Vector3.SignedAngle(reference, turned, axis);
    }

    private Transform ResolveWheel()
    {
        foreach (Transform candidate in GetComponentsInChildren<Transform>(true))
        {
            if (candidate.name == "CT_WheelSpin")
            {
                return candidate;
            }
        }

        return null;
    }

    /// <summary>Fast off the mark, long tail: 1 - (1 - t)^4 sampled into a curve.</summary>
    private static AnimationCurve BuildDefaultEasing()
    {
        const int samples = 12;
        var keys = new Keyframe[samples];
        for (int i = 0; i < samples; i++)
        {
            float t = i / (float)(samples - 1);
            float inverse = 1f - t;
            keys[i] = new Keyframe(t, 1f - inverse * inverse * inverse * inverse);
        }

        var curve = new AnimationCurve(keys);
        for (int i = 0; i < samples; i++)
        {
            curve.SmoothTangents(i, 0f);
        }

        return curve;
    }
}
