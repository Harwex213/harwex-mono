using System;
using System.Collections;
using UnityEngine;

/// <summary>
/// Moves the camera between the shots the show needs, and hands it back to
/// <see cref="CameraSwing"/> when the wide shot returns.
///
/// A shot is aimed at the game being played, not authored as a pose, so the framing follows that
/// game's rig if it is ever moved. The camera sits <see cref="Shot.distance"/> in front of the aim
/// point, <see cref="Shot.yawDegrees"/> around it and <see cref="Shot.heightOffset"/> above it, and
/// it looks straight back at that point.
///
/// Each game hands over two transforms, and the two are read for different things. The first gives
/// the aim position, so a shot sits on the part of the rig that matters. The second gives the
/// facing, so a yaw of 0 stands straight in front of the game. Keeping the two apart lets the wheel
/// aim at its hub, which spins, while it takes its facing from the rig, which stands still.
///
/// Three rigs have shots here. The main round is aimed at the hero wheel, and its wide shot is the
/// pose authored in the scene, with the jib swing running. The bonus dice round is aimed at the
/// acrylic cabinet. The two slot rounds, bonus luck and bonus deluxe, are both aimed at the one
/// Golden Luck machine, because both play on it. Every shot outside the main round is locked off,
/// the way a studio cuts to a fixed camera for the moment that matters.
/// </summary>
[DisallowMultipleComponent]
[RequireComponent(typeof(Camera))]
public class ShowCamera : MonoBehaviour
{
    /// <summary>One framing of a game, built from the aim point outwards.</summary>
    [Serializable]
    public class Shot
    {
        [Tooltip("Where the camera looks, measured from the rig this shot is aimed at.")]
        public Vector3 aimOffset;

        [Tooltip("Metres from the aim point to the camera.")]
        [Min(0.1f)] public float distance = 5f;

        [Tooltip("Degrees around the rig. 0 stands straight in front of the game.")]
        public float yawDegrees;

        [Tooltip("Metres the camera sits above the aim point.")]
        public float heightOffset;

        [Tooltip("Field of view for this shot. 0 keeps the one authored in the scene.")]
        [Min(0f)] public float fieldOfView;

        [Tooltip("Seconds the move into this shot takes.")]
        [Min(0f)] public float moveDuration = 1.2f;
    }

    [Header("Wiring")]
    // This disc turns as the wheel spins, so its rotation is not a facing. Read the position from
    // here and the facing from targetBasis, and never wire a facing to this transform again.
    [Tooltip("The spinning wheel disc. Its position is the hub every wheel shot is aimed from.")]
    [SerializeField] private Transform target;

    [Tooltip(
        "The wheel rig, which stands still while the disc spins. Every wheel shot reads its yaw " +
        "and its aim offset in this frame. Left empty, the wheel shots are read in world space, " +
        "where +Z is the front.")]
    [SerializeField] private Transform targetBasis;

    [Tooltip("The jib swing. It runs in the wide shot and stops in every other shot.")]
    [SerializeField] private CameraSwing swing;

    [Header("Shots")]
    [Tooltip("Closer to the wheel while it spins, with the whole rim still in frame.")]
    [SerializeField]
    private Shot spinShot = new()
    {
        aimOffset = Vector3.zero,
        distance = 5.2f,
        yawDegrees = 0f,
        heightOffset = 0.4f,
        fieldOfView = 40f,
        moveDuration = 1.2f,
    };

    [Tooltip("Close on the flapper at the top of the wheel, where the winning segment stops.")]
    [SerializeField]
    private Shot resultShot = new()
    {
        // The flapper stands in front of the rim. Yaw slides the flapper off the segment it points
        // at. A yaw of 0 keeps the two lined up.
        aimOffset = new Vector3(0f, 1.05f, 0.2f),
        distance = 2.5f,
        yawDegrees = 0f,
        heightOffset = 0.25f,
        fieldOfView = 31f,
        moveDuration = 0.9f,
    };

    [Header("Bonus dice")]
    [Tooltip(
        "The dice cabinet's frame: origin at the foot of the cabinet, forward facing the audience. " +
        "Left empty, the dice round is shot on the wheel like the other bonus rounds.")]
    [SerializeField] private Transform diceTarget;

    [Tooltip("The whole cabinet in frame. This is the shot the switch into the dice round moves to.")]
    [SerializeField]
    private Shot diceWideShot = new()
    {
        // The cabinet stands 2.9 m tall, so it only fits at this distance.
        aimOffset = new Vector3(0.15f, 1.45f, 0f),
        distance = 4.3f,
        yawDegrees = 0f,
        heightOffset = 0.25f,
        fieldOfView = 40f,
        moveDuration = 1.6f,
    };

    [Tooltip("Holds the whole drop, from the release at the top of the cabinet down to its floor.")]
    [SerializeField]
    private Shot diceSpinShot = new()
    {
        // Both bays are played, so the shot is centred on the cabinet rather than biased onto one
        // of them. The distance fits the 2.72 m of play area in frame at 40 degrees. The camera
        // stays level with the aim, so neither the release at the top nor the floor is cropped.
        aimOffset = new Vector3(0f, 1.45f, 0f),
        distance = 4f,
        yawDegrees = 0f,
        heightOffset = 0f,
        fieldOfView = 40f,
        moveDuration = 1f,
    };

    [Tooltip("Down onto the floor of both bays, where the dice come to rest showing their faces.")]
    [SerializeField]
    private Shot diceResultShot = new()
    {
        // Both bays are read off this one shot. The dice come to rest anywhere over 1.28 m of
        // floor, the pip dice left of the mullion and the colour dice right of it, and the aim
        // sits a little over the floor so the plinth does not take the bottom of the frame.
        aimOffset = new Vector3(0f, 0.24f, 0f),
        distance = 1f,
        yawDegrees = 0f,
        // The camera looks down on the dice at about 39 degrees. It has to clear the cabinet's
        // bottom rail, which stands in front of the dice and hides them from a level camera, and
        // the face on top of a die is the face the roll counts — a flatter shot reads the front
        // of each die instead, which is a different number and a different colour.
        heightOffset = 0.8f,
        fieldOfView = 35f,
        moveDuration = 0.9f,
    };

    [Header("Bonus luck and bonus deluxe")]
    [Tooltip(
        "The slot machine's frame: origin at the foot of the cabinet, forward out of its face. " +
        "Left empty, it is looked up in the scene, and with no machine at all both slot rounds " +
        "are shot on the wheel like the other bonus rounds.")]
    [SerializeField] private Transform slotTarget;

    // The three shots below are written in metres against a cabinet 2.88 m tall whose reel window
    // sits 0.35 m in front of its origin, centred 1.73 m up and 0.75 m tall. Rescaling the machine
    // in the scene does not carry the offsets with it, so re-measure them if it ever changes size.
    [Tooltip("The whole cabinet in frame. This is the shot a switch into either slot round moves to.")]
    [SerializeField]
    private Shot slotWideShot = new()
    {
        // 4.3 m at 40 degrees puts 3.13 m of height in frame, which holds the 2.88 m cabinet with a
        // hand's width of floor under it and no more.
        aimOffset = new Vector3(0f, 1.45f, 0.35f),
        distance = 4.3f,
        yawDegrees = 0f,
        heightOffset = 0.35f,
        fieldOfView = 40f,
        moveDuration = 1.6f,
    };

    [Tooltip("The reel bay and the logo above it, close enough to read the symbols as they turn.")]
    [SerializeField]
    private Shot slotSpinShot = new()
    {
        // Level with the aim, like the result shot: the camera sits above the reel window otherwise
        // and the tilt crops the GOLDEN LUCK sign off the top of the frame.
        aimOffset = new Vector3(0f, 1.8f, 0.35f),
        distance = 2.5f,
        yawDegrees = 0f,
        heightOffset = 0f,
        fieldOfView = 38f,
        moveDuration = 1.1f,
    };

    [Tooltip("Pushed in on the win line, where the three symbols that pay come to rest.")]
    [SerializeField]
    private Shot slotResultShot = new()
    {
        // Aimed at the win line, the third of the four visible positions, 1.64 m up. The distance
        // is set by the width rather than the height: the three reels span 1.37 m, so a closer shot
        // than this crops the outer two and the line can no longer be read as a line. The camera
        // stays level with the aim, because the reels are a flat panel and a raised shot keystones
        // them.
        aimOffset = new Vector3(0f, 1.64f, 0.35f),
        distance = 1.6f,
        yawDegrees = 0f,
        heightOffset = 0f,
        fieldOfView = 32f,
        moveDuration = 0.9f,
    };

    [Header("Wide")]
    [Tooltip(
        "Seconds the move back to the authored pose takes. A switch is not reported done until " +
        "the camera lands, so this is how long a MAIN_SWITCH runs. Keep it near the dice shots' " +
        "own move durations, or switching between the two games reads lopsided.")]
    [SerializeField, Min(0f)] private float returnDuration = 1.6f;

    /// <summary>The shot on screen, for the console.</summary>
    public string CurrentShot { get; private set; } = "wide";

    /// <summary>True while the camera is still travelling to the shot it was last sent to.</summary>
    public bool IsMoving
    {
        get { return move != null; }
    }

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

        var wheel = FindFirstObjectByType<CrazyTimeWheel>();

        if (target == null && wheel != null)
        {
            target = wheel.transform;
        }

        if (target == null)
        {
            Debug.LogWarning("ShowCamera: no wheel to aim at. The camera holds the wide shot.", this);
        }

        if (targetBasis == null && wheel != null)
        {
            // The rig root does not spin, so its facing is the one the wheel shots were authored
            // against. The rig also stands unrotated, so leaving this empty gives the same framing.
            targetBasis = wheel.transform;
        }

        if (slotTarget == null)
        {
            var slot = FindFirstObjectByType<SlotMachineController>();
            if (slot != null)
            {
                // The cabinet's own root: it stands on the floor and its forward is its face, which
                // is the frame the three slot shots are written in.
                slotTarget = slot.transform;
            }
        }

        // CameraSwing only writes to the transform from LateUpdate, so this is the authored pose.
        widePosition = transform.localPosition;
        wideRotation = transform.localRotation;
        wideFieldOfView = cam.fieldOfView;
    }

    /// <summary>Moves in for the spin or the drop, with the whole of the game still in frame.</summary>
    public void FrameSpin(ShowGame game)
    {
        if (HasDiceRig(game))
        {
            Frame("dice-spin", diceSpinShot, diceTarget, diceTarget);
            return;
        }

        if (HasSlotRig(game))
        {
            Frame("slot-spin", slotSpinShot, slotTarget, slotTarget);
            return;
        }

        Frame("spin", spinShot, target, targetBasis);
    }

    /// <summary>
    /// Moves close on what the round has just decided: the winning segment, the dice where they lie,
    /// or the slot machine's win line.
    /// </summary>
    public void FrameResult(ShowGame game)
    {
        if (HasDiceRig(game))
        {
            Frame("dice-result", diceResultShot, diceTarget, diceTarget);
            return;
        }

        if (HasSlotRig(game))
        {
            Frame("slot-result", slotResultShot, slotTarget, slotTarget);
            return;
        }

        Frame("result", resultShot, target, targetBasis);
    }

    /// <summary>
    /// The shot a round opens and closes on. For the dice round that is the whole cabinet; for
    /// every other round it is the pose authored in the scene, with the jib swing running again.
    /// </summary>
    public void FrameWide(ShowGame game)
    {
        if (HasDiceRig(game))
        {
            Frame("dice-wide", diceWideShot, diceTarget, diceTarget);
            return;
        }

        if (HasSlotRig(game))
        {
            Frame("slot-wide", slotWideShot, slotTarget, slotTarget);
            return;
        }

        if (CurrentShot == "wide" && move == null)
        {
            return;
        }

        Debug.Log($"[Camera] {CurrentShot} -> wide over {returnDuration:0.0#}s", this);
        CurrentShot = "wide";

        StopMove();
        move = StartCoroutine(MoveTo(widePosition, wideRotation, wideFieldOfView, returnDuration, true));
    }

    /// <summary>True when this round is the dice round and the cabinet is wired up to shoot.</summary>
    private bool HasDiceRig(ShowGame game)
    {
        return game == ShowGame.BonusDice && diceTarget != null;
    }

    /// <summary>
    /// True when this round is one of the two slot rounds and the machine is wired up to shoot. Both
    /// rounds play on the one cabinet, so both take the same three shots.
    /// </summary>
    private bool HasSlotRig(ShowGame game)
    {
        return ShowStage.IsSlotGame(game) && slotTarget != null;
    }

    /// <summary>
    /// Moves the camera to one shot. <paramref name="aimAt"/> gives the position the shot is aimed
    /// at, and <paramref name="basis"/> gives the facing the shot is written against. The two are
    /// separate because a rig can aim at a part that turns, and a turning part carries no facing.
    /// </summary>
    private void Frame(string shotName, Shot shot, Transform aimAt, Transform basis)
    {
        if (aimAt == null)
        {
            return;
        }

        if (CurrentShot == shotName && move == null)
        {
            return;
        }

        // The shot is written in the basis frame, flattened to the horizontal plane: yaw 0 stands
        // straight in front of the game and the aim offset runs across, up and out from the aim
        // point. The wheel rig faces down +Z, so its shots read the same as they did before.
        Quaternion level = LevelFacing(basis);

        Vector3 aim = aimAt.position + level * shot.aimOffset;
        Vector3 back = level * (Quaternion.Euler(0f, shot.yawDegrees, 0f) * Vector3.forward);
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

    /// <summary>
    /// The horizontal facing of a transform, as the frame a shot is written in. A missing transform
    /// gives world space, and so does one that points straight up or down.
    /// </summary>
    private static Quaternion LevelFacing(Transform basis)
    {
        if (basis == null)
        {
            return Quaternion.identity;
        }

        Vector3 facing = basis.forward;
        facing.y = 0f;

        if (facing.sqrMagnitude <= 1e-6f)
        {
            return Quaternion.identity;
        }

        return Quaternion.LookRotation(facing.normalized, Vector3.up);
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
