using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

/// <summary>
/// Spins the Crazy Time wheel. Put this on CT_WheelSpin.
/// </summary>
[DisallowMultipleComponent]
public class WheelSpinner : MonoBehaviour
{
    [System.Serializable] public class SegmentEvent : UnityEvent<int> { }

    // The FBX comes out of Blender with a Z-up basis, and Unity leaves that basis on
    // CT_Root. So the wheel's face normal is this pivot's local Y, not its local Z.
    static readonly Vector3 SpinAxis = Vector3.up;

    [Header("Idle spin")]
    [Tooltip("Start free-spinning as soon as the scene runs.")]
    [SerializeField] bool spinOnStart = true;
    [Tooltip("Degrees per second. Positive turns counter-clockwise seen from the wheel's face.")]
    [SerializeField] float idleSpeed = 45f;

    [Header("Spin to a segment")]
    [Tooltip("CT_FlapPointer. Leave empty to treat the top of the wheel as the stop position.")]
    [SerializeField] Transform pointer;
    [Tooltip("Full turns added before the wheel settles on the target segment.")]
    [SerializeField] int extraRevolutions = 4;
    [Tooltip("Seconds from launch to standstill.")]
    [SerializeField] float spinDuration = 6f;

    /// <summary>Fires with the segment index once a SpinToSegment call has settled.</summary>
    public SegmentEvent onSegmentLanded;

    Quaternion restRotation;   // CT_WheelSpin's authored offset - the zero of every angle below
    float angle;               // degrees turned away from restRotation
    float pointerAngle;        // where the pointer sits, in the wheel's rest frame
    float[] segmentAngles;     // where each segment sits, in the wheel's rest frame
    Coroutine running;

    public bool IsSpinning => running != null;
    public int SegmentCount => segmentAngles != null ? segmentAngles.Length : 0;

    void Awake()
    {
        restRotation = transform.localRotation;
        MeasureLayout();   // must run before anything turns the wheel
    }

    void Start()
    {
        if (spinOnStart) StartFreeSpin();
    }

    /// <summary>Free-spins at idleSpeed until something else takes over.</summary>
    public void StartFreeSpin()
    {
        Stop();
        running = StartCoroutine(FreeSpin());
    }

    /// <summary>Spins down onto <paramref name="segment"/>, which lands under the pointer.</summary>
    public void SpinToSegment(int segment)
    {
        int count = SegmentCount;
        if (count == 0)
        {
            Debug.LogError("WheelSpinner: no CT_Num_* / CT_Bonus_* children found under " + name, this);
            return;
        }
        segment = ((segment % count) + count) % count;
        Stop();
        running = StartCoroutine(SpinDown(segment));
    }

    /// <summary>Spins down onto a segment picked at random.</summary>
    public void SpinToRandomSegment() => SpinToSegment(Random.Range(0, SegmentCount));

    public void Stop()
    {
        if (running != null) StopCoroutine(running);
        running = null;
    }

    IEnumerator FreeSpin()
    {
        while (true)
        {
            Apply(angle + idleSpeed * Time.deltaTime);
            yield return null;
        }
    }

    IEnumerator SpinDown(int segment)
    {
        // A positive turn about the local +Y axis walks a point backwards through these
        // angles, so rotating by theta moves segment i to segmentAngles[i] - theta. The
        // segment sits under the pointer when theta == segmentAngles[i] - pointerAngle.
        float landing = Mathf.Repeat(segmentAngles[segment] - pointerAngle, 360f);
        float direction = idleSpeed < 0f ? -1f : 1f;
        float from = angle;
        float sweep = Mathf.Repeat((landing - from) * direction, 360f)
                    + 360f * Mathf.Max(0, extraRevolutions);
        float to = from + sweep * direction;

        float t = 0f;
        while (t < spinDuration)
        {
            t += Time.deltaTime;
            float k = Mathf.Clamp01(t / spinDuration);
            k = 1f - Mathf.Pow(1f - k, 4f);   // ease out: fast launch, long coast, soft stop
            Apply(Mathf.Lerp(from, to, k));
            yield return null;
        }

        Apply(to);
        running = null;
        onSegmentLanded?.Invoke(segment);
    }

    void Apply(float degrees)
    {
        angle = Mathf.Repeat(degrees, 360f);
        transform.localRotation = restRotation * Quaternion.AngleAxis(angle, SpinAxis);
    }

    /// <summary>
    /// Reads the segment labels and the pointer off the scene, so the angles stay correct
    /// even if the wheel is re-exported with a different segment count or offset.
    /// Only valid while the wheel still sits at its rest rotation.
    /// </summary>
    void MeasureLayout()
    {
        var labels = new List<Transform>();
        foreach (Transform child in transform)
            if (child.name.StartsWith("CT_Num_") || child.name.StartsWith("CT_Bonus_"))
                labels.Add(child);

        // The trailing digits are the segment index: CT_Bonus_00, CT_Num_01, ... CT_Num_53.
        labels.Sort((a, b) => IndexOf(a.name).CompareTo(IndexOf(b.name)));

        segmentAngles = new float[labels.Count];
        for (int i = 0; i < labels.Count; i++)
            segmentAngles[i] = LocalAngle(labels[i].position);

        // Local +Y is the spin axis and local -Z points up in the world, so the top of the
        // wheel sits at 270 degrees - that is where the flap pointer is.
        pointerAngle = pointer != null ? LocalAngle(MarkerPoint(pointer)) : 270f;
    }

    /// <summary>
    /// CT_FlapPointer's transform sits at the model origin - only its mesh is up at the
    /// top of the wheel - so the geometry is what marks the stop position. The segment
    /// labels do carry real transform positions, so those are read directly.
    /// </summary>
    static Vector3 MarkerPoint(Transform t)
    {
        var renderer = t.GetComponent<Renderer>();
        return renderer != null ? renderer.bounds.center : t.position;
    }

    /// <summary>Angle of a world point around the spin axis, measured in this pivot's frame.</summary>
    float LocalAngle(Vector3 worldPoint)
    {
        Vector3 p = transform.InverseTransformPoint(worldPoint);
        return Mathf.Repeat(Mathf.Atan2(p.z, p.x) * Mathf.Rad2Deg, 360f);
    }

    static int IndexOf(string labelName)
    {
        int i = labelName.LastIndexOf('_') + 1;
        return int.TryParse(labelName.Substring(i), out int n) ? n : 0;
    }
}
