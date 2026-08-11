using UnityEngine;

/// <summary>
/// Swings the camera slowly around a pivot in front of it, the way a studio jib arm drifts
/// while the show is on air.
///
/// The pose authored in the scene is the centre of the swing. It is captured when the component
/// is enabled and restored when it is disabled, so the effect never leaves the camera off its mark.
///
/// Yaw and pitch move the camera along an arc about <see cref="pivot"/>; roll only tilts it in
/// place. With <see cref="aimAtPivot"/> on, the pivot stays framed and the swing reads as parallax.
/// With it off, the camera turns with the arc and the framing drifts as well.
///
/// Each axis runs on its own period. The periods are deliberately unequal, so the three axes
/// drift in and out of step and the motion never repeats on a short cycle.
/// </summary>
[DisallowMultipleComponent]
public class CameraSwing : MonoBehaviour
{
    private const float TwoPi = 2f * Mathf.PI;

    [Header("Pivot")]
    [Tooltip("Point the camera swings around. Left empty, a point straight ahead is used.")]
    [SerializeField] private Transform pivot;

    [Tooltip("Distance to the pivot point ahead of the camera, used while no pivot is set.")]
    [SerializeField, Min(0.01f)] private float pivotDistance = 5f;

    [Header("Swing")]
    [Tooltip("Scales all three axes at once. 0 holds the camera still.")]
    [SerializeField, Min(0f)] private float intensity = 1f;

    [Tooltip("Degrees the camera swings sideways about the pivot, either way of centre.")]
    [SerializeField, Min(0f)] private float yawAmplitudeDegrees = 2.2f;

    [SerializeField, Min(0.1f)] private float yawPeriod = 12f;

    [Tooltip("Degrees the camera rises and dips about the pivot, either way of centre.")]
    [SerializeField, Min(0f)] private float pitchAmplitudeDegrees = 0.9f;

    [SerializeField, Min(0.1f)] private float pitchPeriod = 8.3f;

    [Tooltip("Degrees the horizon tilts. Roll turns the camera in place, it does not move it.")]
    [SerializeField, Min(0f)] private float rollAmplitudeDegrees = 0.4f;

    [SerializeField, Min(0.1f)] private float rollPeriod = 15f;

    [Header("Feel")]
    [Tooltip("Keep the pivot centred in frame. Off, the camera turns with the arc.")]
    [SerializeField] private bool aimAtPivot = true;

    [Tooltip("Seconds the swing takes to grow to full amplitude, so it does not start mid-move.")]
    [SerializeField, Min(0f)] private float easeInDuration = 2f;

    [Tooltip("Shifts every axis along its wave, to stagger cameras that share these settings.")]
    [SerializeField] private float phaseOffset;

    [Tooltip("Keep swinging while the game is paused on Time.timeScale = 0.")]
    [SerializeField] private bool ignoreTimeScale;

    /// <summary>Authored local pose, restored on disable and used as the centre of the swing.</summary>
    private Vector3 basePosition;

    private Quaternion baseRotation;

    /// <summary>Seconds the swing has been running, which is what drives the waves.</summary>
    private float elapsed;

    /// <summary>Scales all three axes at once. 0 holds the camera still.</summary>
    public float Intensity
    {
        get { return intensity; }
        set { intensity = Mathf.Max(0f, value); }
    }

    private void OnEnable()
    {
        CaptureBasePose();
        elapsed = 0f;
    }

    private void OnDisable()
    {
        // Hand the camera back on its authored mark, not wherever the last frame left it.
        transform.localPosition = basePosition;
        transform.localRotation = baseRotation;
    }

    /// <summary>Reads the current pose as the new centre of the swing.</summary>
    public void CaptureBasePose()
    {
        basePosition = transform.localPosition;
        baseRotation = transform.localRotation;
    }

    /// <summary>Returns the camera to centre and starts the swing again from a standstill.</summary>
    public void Restart()
    {
        transform.localPosition = basePosition;
        transform.localRotation = baseRotation;
        elapsed = 0f;
    }

    private void LateUpdate()
    {
        elapsed += ignoreTimeScale ? Time.unscaledDeltaTime : Time.deltaTime;

        float ease = easeInDuration > 0f ? Mathf.SmoothStep(0f, 1f, elapsed / easeInDuration) : 1f;
        float scale = intensity * ease;

        float yaw = yawAmplitudeDegrees * scale * Wave(yawPeriod, phaseOffset);
        float pitch = pitchAmplitudeDegrees * scale * Wave(pitchPeriod, phaseOffset + 0.31f);
        float roll = rollAmplitudeDegrees * scale * Wave(rollPeriod, phaseOffset + 0.67f);

        // Yaw about the parent's up axis keeps the arc level; pitch about the authored right axis
        // keeps the rise square to the shot.
        Vector3 right = baseRotation * Vector3.right;
        Quaternion arc = Quaternion.AngleAxis(yaw, Vector3.up) * Quaternion.AngleAxis(pitch, right);

        Vector3 pivotPoint = ResolvePivotPoint();
        Vector3 fromPivot = arc * (basePosition - pivotPoint);
        Vector3 position = pivotPoint + fromPivot;

        Quaternion rotation;
        if (aimAtPivot && fromPivot.sqrMagnitude > 1e-6f)
        {
            rotation = Quaternion.LookRotation(-fromPivot, Vector3.up);
        }
        else
        {
            rotation = arc * baseRotation;
        }

        transform.localPosition = position;
        transform.localRotation = rotation * Quaternion.AngleAxis(roll, Vector3.forward);
    }

    /// <summary>The pivot in the camera's parent space, which is world space at the scene root.</summary>
    private Vector3 ResolvePivotPoint()
    {
        if (pivot == null)
        {
            return basePosition + baseRotation * Vector3.forward * pivotDistance;
        }

        Transform parent = transform.parent;
        return parent == null ? pivot.position : parent.InverseTransformPoint(pivot.position);
    }

    /// <summary>
    /// A sine over <paramref name="period"/> seconds with a faster, quieter harmonic mixed in,
    /// which keeps the swing off a plain back-and-forth. Stays within -1 to 1.
    /// </summary>
    private float Wave(float period, float phase)
    {
        float primary = Mathf.Sin(TwoPi * (elapsed / period + phase));
        float harmonic = Mathf.Sin(TwoPi * (elapsed / (period * 0.41f) + phase * 1.7f));
        return (primary + 0.28f * harmonic) / 1.28f;
    }
}
