using System;
using System.Collections;
using UnityEngine;

/// <summary>
/// Moves the camera between the shots the show needs, and hands it back to
/// <see cref="CameraSwing"/> when the wide shot returns.
///
/// A shot is aimed at the hero wheel, not authored as a pose, so the framing follows the wheel if
/// the rig ever moves. The camera sits <see cref="Shot.distance"/> in front of the aim point,
/// <see cref="Shot.yawDegrees"/> around it and <see cref="Shot.heightOffset"/> above it, and it
/// looks straight back at that point.
///
/// The wide shot is the pose authored in the scene. The jib swing runs in the wide shot alone;
/// the spin and result shots are locked off, the way a studio cuts to a fixed camera for the
/// moment that matters.
/// </summary>
[DisallowMultipleComponent]
[RequireComponent(typeof(Camera))]
public class ShowCamera : MonoBehaviour
{
    /// <summary>One framing of the wheel, built from the aim point outwards.</summary>
    [Serializable]
    public class Shot
    {
        [Tooltip("Where the camera looks, measured from the centre of the wheel.")]
        public Vector3 aimOffset;

        [Tooltip("Metres from the aim point to the camera.")]
        [Min(0.1f)] public float distance = 5f;

        [Tooltip("Degrees around the wheel. 0 is straight in front of it.")]
        public float yawDegrees;

        [Tooltip("Metres the camera sits above the aim point.")]
        public float heightOffset;

        [Tooltip("Field of view for this shot. 0 keeps the one authored in the scene.")]
        [Min(0f)] public float fieldOfView;

        [Tooltip("Seconds the move into this shot takes.")]
        [Min(0f)] public float moveDuration = 1.2f;
    }

    [Header("Wiring")]
    [Tooltip("The spinning wheel disc. Its position is the centre every shot is aimed from.")]
    [SerializeField] private Transform target;

    [Tooltip("The jib swing. It runs in the wide shot and stops in every other shot.")]
    [SerializeField] private CameraSwing swing;

    [Header("Shots")]
    [Tooltip("Closer to the wheel while it spins, with the whole rim still in frame.")]
    [SerializeField]
    private Shot spinShot = new()
    {
        aimOffset = Vector3.zero,
        distance = 5.2f,
        yawDegrees = 6f,
        heightOffset = 0.4f,
        fieldOfView = 40f,
        moveDuration = 1.2f,
    };

    [Tooltip("Close on the flapper at the top of the wheel, where the winning segment stops.")]
    [SerializeField]
    private Shot resultShot = new()
    {
        // The flapper stands in front of the rim, so a wide angle slides it off the segment it
        // points at. Ten degrees keeps some depth without breaking that read.
        aimOffset = new Vector3(0f, 1.05f, 0.2f),
        distance = 2.5f,
        yawDegrees = 10f,
        heightOffset = 0.25f,
        fieldOfView = 31f,
        moveDuration = 0.9f,
    };

    [Header("Wide")]
    [Tooltip("Seconds the move back to the authored pose takes.")]
    [SerializeField, Min(0f)] private float returnDuration = 1.4f;

    /// <summary>The shot on screen, for the console.</summary>
    public string CurrentShot { get; private set; } = "wide";

    private Camera cam;

    /// <summary>The pose and lens authored in the scene. The wide shot returns to them.</summary>
    private Vector3 widePosition;

    private Quaternion wideRotation;
    private float wideFieldOfView;

    private Coroutine move;

    private void Awake()
    {
        cam = GetComponent<Camera>();

        if (swing == null)
        {
            swing = GetComponent<CameraSwing>();
        }

        if (target == null)
        {
            var wheel = FindFirstObjectByType<CrazyTimeWheel>();
            if (wheel != null)
            {
                target = wheel.transform;
            }
        }

        if (target == null)
        {
            Debug.LogWarning("ShowCamera: no wheel to aim at. The camera holds the wide shot.", this);
        }

        // CameraSwing only writes to the transform from LateUpdate, so this is the authored pose.
        widePosition = transform.localPosition;
        wideRotation = transform.localRotation;
        wideFieldOfView = cam.fieldOfView;
    }

    /// <summary>Moves in for the spin, with the whole wheel still in frame.</summary>
    public void FrameSpin()
    {
        Frame("spin", spinShot);
    }

    /// <summary>Moves close on the flapper, so the winning segment reads.</summary>
    public void FrameResult()
    {
        Frame("result", resultShot);
    }

    /// <summary>Pulls back to the authored pose and starts the jib swing again.</summary>
    public void FrameWide()
    {
        if (CurrentShot == "wide" && move == null)
        {
            return;
        }

        Debug.Log($"[Camera] {CurrentShot} -> wide over {returnDuration:0.0#}s", this);
        CurrentShot = "wide";

        StopMove();
        move = StartCoroutine(MoveTo(widePosition, wideRotation, wideFieldOfView, returnDuration, true));
    }

    private void Frame(string shotName, Shot shot)
    {
        if (target == null)
        {
            return;
        }

        if (CurrentShot == shotName && move == null)
        {
            return;
        }

        Vector3 aim = target.position + shot.aimOffset;
        Vector3 back = Quaternion.Euler(0f, shot.yawDegrees, 0f) * Vector3.forward;
        Vector3 position = aim + back * shot.distance + Vector3.up * shot.heightOffset;
        Quaternion rotation = Quaternion.LookRotation(aim - position, Vector3.up);
        float fieldOfView = shot.fieldOfView > 0f ? shot.fieldOfView : wideFieldOfView;

        Debug.Log(
            $"[Camera] {CurrentShot} -> {shotName} over {shot.moveDuration:0.0#}s | " +
            $"aim={aim} distance={shot.distance:0.0#} yaw={shot.yawDegrees:0.#} fov={fieldOfView:0.#}",
            this);

        CurrentShot = shotName;

        StopMove();
        move = StartCoroutine(MoveTo(position, rotation, fieldOfView, shot.moveDuration, false));
    }

    private IEnumerator MoveTo(
        Vector3 position,
        Quaternion rotation,
        float fieldOfView,
        float duration,
        bool swingAtTheEnd)
    {
        HoldPoseAndStopSwing();

        Vector3 fromPosition = transform.localPosition;
        Quaternion fromRotation = transform.localRotation;
        float fromFieldOfView = cam.fieldOfView;

        float elapsed = 0f;
        while (elapsed < duration)
        {
            elapsed += Time.deltaTime;
            float t = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(elapsed / duration));

            transform.localPosition = Vector3.Lerp(fromPosition, position, t);
            transform.localRotation = Quaternion.Slerp(fromRotation, rotation, t);
            cam.fieldOfView = Mathf.Lerp(fromFieldOfView, fieldOfView, t);

            yield return null;
        }

        transform.localPosition = position;
        transform.localRotation = rotation;
        cam.fieldOfView = fieldOfView;

        move = null;

        if (swingAtTheEnd && swing != null)
        {
            // The swing reads the pose it is enabled on as the centre of its arc, and the camera
            // stands on its authored mark right now.
            swing.enabled = true;
        }
    }

    /// <summary>
    /// Stops the swing without letting it snap the camera back. The swing restores the authored
    /// pose as it is disabled, so the pose on screen is put back straight after.
    /// </summary>
    private void HoldPoseAndStopSwing()
    {
        if (swing == null || !swing.enabled)
        {
            return;
        }

        Vector3 position = transform.localPosition;
        Quaternion rotation = transform.localRotation;

        swing.enabled = false;

        transform.localPosition = position;
        transform.localRotation = rotation;
    }

    private void StopMove()
    {
        if (move != null)
        {
            StopCoroutine(move);
            move = null;
        }
    }
}
