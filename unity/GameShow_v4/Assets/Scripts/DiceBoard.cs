using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>The colour a colour die can come to rest showing.</summary>
public enum DieColour
{
    Red,
    Green,
    Blue,
}

/// <summary>
/// The bonus dice game. Both bays of the acrylic cabinet are played at once, and every die is
/// released together at the top of the cabinet. Three pip dice fall down the wide bay on the
/// left and their faces are added up; two colour dice fall down the narrow bay on the right and
/// the face each one shows is red, green or blue. The roll is the sum and the pair of colours.
///
/// The cabinet in <c>AcrylicGameBoard.fbx</c> carries no colliders, so this component builds
/// them: the four walls of the play cavity, its floor and deck, one capsule per peg and one box
/// per deflector bar. They are rebuilt from scratch every time, so a half-built rig cannot
/// survive. Every dimension is read from the generator that made the model,
/// <c>models/_scripts/17_acrylic_game_board.py</c> — that script stays the source of truth, and
/// the constants here are its numbers in Blender metres.
///
/// The colliders reach right through the cavity, front sheet to back sheet, while the modelled
/// pegs only stand 70 mm proud of the back sheet. That is deliberate: a die must not be able to
/// slip past a peg it looks like it should have hit.
///
/// Each bay passes a die of its own size, and the two sizes are not the same. Take every obstacle
/// of a bay and every chain of them that runs from one wall to the other: the widest gap of the
/// tightest such chain is the widest thing the bay passes. That measures 68.5 mm in the narrow
/// bay, whose three columns of fat pegs are evenly pitched, and 64.0 mm in the wide bay, which is
/// laid out for a far smaller ball. A cube passes a gap at any angle once its long diagonal fits,
/// so the narrow bay takes the 39 mm colour dice, and the wide bay takes the pip dice at 30 mm —
/// the same 39 mm model, placed in the scene at 30/39 of its size, with its mass scaled by the
/// cube of that so the two kinds of die keep one density.
///
/// Fitting the bay is not the same as falling through it cleanly, and the size was picked by
/// soaking 500 rolls per candidate rather than by the diagonal alone. No size from 26 to 36 mm
/// ever left a die stranded, because the nudge always frees one in the end; what the size decides
/// is how often a die has to be nudged at all, and that is what an audience sees. Rolls needing at
/// least one nudge: 56% at 36 mm, 34% at 33 mm, 23% at 32 mm, 23% at 30 mm, 32% at 28 mm, 40% at
/// 26 mm. Smaller is therefore not monotonically better — under 30 mm a die is small enough to
/// enter the narrow channels along the walls, where it then has to be shaken out. 31 mm and 33 mm
/// both sit worse than their neighbours, so the good sizes are a pocket set by the peg pitch, not
/// a threshold. 30 mm and 32 mm tie on that rate; 30 mm was taken for the lower nudges per roll
/// (0.35 against 0.42) and the shorter worst-case roll (6.9 s against 8.4 s). At 36 mm one roll in
/// 200 ran the full 14 s timeout out.
///
/// A peg is a cylinder lying across the cabinet, and a die can land square on the crown of one and
/// balance there. That happened to about one die in eighty. So a roll is only over once every die
/// is on the floor: a die that stops making its way down is nudged loose, and only the timeout can
/// end a roll with a die still in the air.
///
/// This component's own transform is the board's frame — the origin sits at the centre of the
/// plinth on the floor, +Y is up and +Z faces the audience — so the whole rig follows the board
/// if the cabinet is ever moved or turned.
/// </summary>
[DisallowMultipleComponent]
public class DiceBoard : MonoBehaviour
{
    /// <summary>The child holding the generated colliders. Destroyed and rebuilt as one.</summary>
    private const string CavityName = "Cavity";

    // ------------------------------------------------------------- board layout --
    // Blender metres, from models/_scripts/17_acrylic_game_board.py.

    private const float W = 1.10f;               // cabinet width
    private const float X0 = -W / 2f;
    private const float X1 = W / 2f;
    private const float TSide = 0.012f;          // back, side and mullion sheets
    private const float TFront = 0.008f;
    private const float FrontSheetY = -0.098f;   // centre plane of the front glazing
    private const float BackSheetY = 0.098f;
    /// <summary>
    /// Floor of the play area: the top face of <c>BaseTrim</c>, measured by dropping rays down the
    /// bay in the model. The trim is a solid slab that covers the whole footprint, so it, and not
    /// the plinth top 15.5 mm under it, is what a die lands on.
    /// </summary>
    private const float BaseTopZ = 0.0905f;

    private const float DeckBottomZ = 2.287f;    // underside of the top deck: its ceiling

    /// <summary>The rails that clamp the glass, front and back, reach this high over the floor.</summary>
    private const float RailTopZ = 0.116f;

    private const float RailFrontY = -0.087f;    // inner face of the front bottom rail
    private const float RailBackY = 0.087f;
    private const float MullionX = 0.14f;
    private const float MullionW = 0.016f;
    private const float LeftBayX1 = MullionX - MullionW / 2f;
    private const float RightBayX0 = MullionX + MullionW / 2f;
    private const float RightBayX1 = X1 - 0.005f;

    /// <summary>Inner faces of the two glazed sheets: the depth a die can move in.</summary>
    private const float CavityFrontY = FrontSheetY + TFront / 2f;

    private const float CavityBackY = BackSheetY - TSide / 2f;
    private const float CavityDepth = CavityBackY - CavityFrontY;
    private const float CavityMidY = (CavityFrontY + CavityBackY) / 2f;

    private const float BarWidth = 0.0115f;      // swept bar of the outline deflectors

    /// <summary>Half thickness of a generated wall. Thick, so nothing tunnels out of the box.</summary>
    private const float WallHalf = 0.02f;

    /// <summary>Deflector outlines, in the board's own XZ plane, exactly as the generator sweeps them.</summary>
    private static readonly Vector2[] Chevron =
    {
        new(-0.055f, -0.017f), new(0f, 0.021f), new(0.055f, -0.017f),
    };

    private static readonly Vector2[] Diamond =
    {
        new(-0.078f, 0f), new(0f, 0.040f), new(0.078f, 0f), new(0f, -0.040f),
    };

    /// <summary>Centres of the two big diamonds, with the angle each is turned by.</summary>
    private static readonly Vector3[] Diamonds =
    {
        new(-0.340f, 1.168f, -9f), new(-0.088f, 1.176f, 11f),
    };

    /// <summary>One row of the upper deflector field: its height, and where its shapes sit across it.</summary>
    private readonly struct ShapeRow
    {
        public readonly float Height;
        public readonly bool Pentagons;
        public readonly float[] Across;

        public ShapeRow(float height, bool pentagons, float[] across)
        {
            Height = height;
            Pentagons = pentagons;
            Across = across;
        }
    }

    /// <summary>The generator's SHAPE_ROWS, bottom row first.</summary>
    private static readonly ShapeRow[] ShapeRows =
    {
        new(1.625f, false, new[] { -0.42f, -0.21f, 0.00f }),
        new(1.748f, true, new[] { -0.315f, -0.105f }),
        new(1.876f, true, new[] { -0.42f, -0.21f, 0.00f }),
        new(1.998f, false, new[] { -0.315f, -0.105f }),
        new(2.112f, false, new[] { -0.42f, -0.21f, 0.00f }),
    };

    /// <summary>
    /// Faces of a die, as the axis of this Unity model that carries them. Unity's FBX import
    /// mirrors X, so the 3 and the 4 sit on the opposite axes to the ones the generator writes.
    /// Measured off the imported mesh, not assumed.
    /// </summary>
    private static readonly Vector3[] FaceAxes =
    {
        Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back,
    };

    private static readonly int[] FaceValues = { 4, 3, 1, 6, 2, 5 };

    /// <summary>
    /// Colours of a colour die, as the axis of this Unity model that carries them. A colour sits
    /// on a pair of opposite faces, so only the axis matters and not which way along it the face
    /// points. Measured off the imported mesh: red is the submesh whose faces face ±X, blue ±Y
    /// and green ±Z. <c>blender/_scripts/19_color_die.py</c> is what puts them there.
    /// </summary>
    private static readonly Vector3[] ColourAxes = { Vector3.right, Vector3.up, Vector3.forward };

    private static readonly DieColour[] ColourValues =
    {
        DieColour.Red, DieColour.Blue, DieColour.Green,
    };

    [Header("Wiring")]
    [Tooltip(
        "The pip dice, which fall down the wide bay on the left. Their faces are the number the " +
        "round pays on. Left empty, every rigidbody under this object that is not a colour die " +
        "is used.")]
    [SerializeField] private Rigidbody[] numberDice;

    [Tooltip("The colour dice, which fall down the narrow bay on the right.")]
    [SerializeField] private Rigidbody[] colourDice;

    [Tooltip("Surface of the cavity walls, pegs and deflectors. Acrylic, so fairly lively.")]
    [SerializeField] private PhysicsMaterial surface;

    [Tooltip(
        "Size the cabinet is placed at in the scene, so the board's own metres become scene " +
        "metres. Read off the BonusDice root, whose scale is 122.98 against a model in centimetres.")]
    [SerializeField, Min(0.01f)] private float boardScale = 1.2298f;

    [Header("Physics")]
    [Tooltip(
        "Contact offset given to the dice and to every collider built here. PhysX defaults to " +
        "10 mm, which is a quarter of a die: at that size the solver works with a die far fatter " +
        "than the one on screen. A couple of millimetres keeps a 39 mm die 39 mm.")]
    [SerializeField, Min(0.0002f)] private float contactOffset = 0.002f;

    [Tooltip(
        "Fixed timestep held for as long as a roll runs, then put back. A die crosses a whole peg " +
        "inside one 20 ms step, so the tumble is resolved coarsely and dice stall on peg crowns " +
        "more often. The dice are the only physics in this scene, so nothing else pays for 10 ms.")]
    [SerializeField, Min(0.001f)] private float rollTimestep = 0.01f;

    [Header("Release")]
    [Tooltip("Height inside the cabinet the dice are released from, in the board's own metres.")]
    [SerializeField] private float releaseHeight = 2.2f;

    [Tooltip(
        "Where across the cabinet each pip die is released, in the board's own metres. The three " +
        "sit over the middle of the wide bay, far enough apart not to touch on the way in. They " +
        "keep off its two side channels on purpose: a chevron is tilted against each side wall " +
        "up there, and the 38 mm it leaves beside the shape row next to it is a trap a die does " +
        "not come out of. Released down the middle no die was left in the field over 120 rolls; " +
        "released at -0.48 one was left in 13 rolls out of 40.")]
    [SerializeField] private float[] numberReleaseAcross = { -0.36f, -0.21f, -0.06f };

    [Tooltip(
        "Where across the cabinet each colour die is released. Both sit over the narrow bay, one " +
        "above each channel between its three columns of pegs.")]
    [SerializeField] private float[] colourReleaseAcross = { 0.286f, 0.407f };

    [Tooltip("Metres either way of the release point the dice are jittered, so no two rolls match.")]
    [SerializeField, Min(0f)] private float releaseJitter = 0.012f;

    [Tooltip("Degrees per second of tumble the dice are released with.")]
    [SerializeField, Min(0f)] private float releaseSpin = 220f;

    [Header("Settling")]
    [Tooltip("A die slower than this, turning slower than the next figure, counts as still.")]
    [SerializeField, Min(0f)] private float stillSpeed = 0.05f;

    [SerializeField, Min(0f)] private float stillSpinDegrees = 25f;

    [Tooltip("Seconds every die must stay still before the roll is called done.")]
    [SerializeField, Min(0f)] private float settleSeconds = 0.45f;

    [Tooltip(
        "Seconds a roll always runs before the dice may count as settled. Shorter than the free " +
        "fall down the cabinet, so it never cuts a real roll short - it is there so a release " +
        "that never got going cannot report the last roll's faces as a new one.")]
    [SerializeField, Min(0f)] private float minimumRollSeconds = 0.5f;

    [Tooltip(
        "Seconds a die off the floor may go without dropping any further before it is nudged " +
        "loose. Stalling is the test, not stillness: a die balanced on a peg often keeps " +
        "trembling above the still thresholds and would otherwise never be nudged at all.")]
    [SerializeField, Min(0.1f)] private float stallSeconds = 0.5f;

    [Tooltip("Metres a die must drop to count as still on its way down.")]
    [SerializeField, Min(0.001f)] private float stallProgress = 0.02f;

    [Tooltip("Never nudge more than this many times per roll; something is wrong past that.")]
    [SerializeField, Min(0)] private int maxNudges = 8;

    [Tooltip("Seconds a roll may run before it is reported done wherever the dice are.")]
    [SerializeField, Min(1f)] private float rollTimeout = 14f;

    /// <summary>True from the release until every die has settled, timed out or been stopped.</summary>
    public bool IsRolling { get; private set; }

    /// <summary>The face each pip die shows, in release order. Empty before the first roll.</summary>
    public int[] Faces { get; private set; } = Array.Empty<int>();

    /// <summary>The colour each colour die shows, in release order. Empty before the first roll.</summary>
    public DieColour[] Colours { get; private set; } = Array.Empty<DieColour>();

    /// <summary>The pip faces added together, which is what a dice round pays on.</summary>
    public int Total
    {
        get
        {
            int total = 0;
            for (int i = 0; i < Faces.Length; i++)
            {
                total += Faces[i];
            }

            return total;
        }
    }

    /// <summary>Raised with the total once the dice have settled.</summary>
    public event Action<int> RollCompleted;

    private Coroutine roll;
    private Transform cavity;
    private float restingTimestep;

    /// <summary>Every die, pip dice first, in the order they are released and reported in.</summary>
    private Rigidbody[] dice = Array.Empty<Rigidbody>();

    // The state one roll carries: the lowest each die has been, how long it has been stuck at
    // that height, and how the roll as a whole is going.
    private float[] lowest = Array.Empty<float>();
    private float[] stalled = Array.Empty<float>();
    private int nudges;
    private float allStillFor;
    private float rollElapsed;

    private void Awake()
    {
        restingTimestep = Time.fixedDeltaTime;

        if (!Rebuild())
        {
            enabled = false;
            return;
        }

        Park();
    }

    /// <summary>
    /// Finds the dice, sets them up and builds the cavity: everything the board needs before it
    /// can roll. Awake calls it, and so does the physics soak, which drives this component from
    /// the editor where Awake never runs. False when there are no dice to roll.
    /// </summary>
    public bool Rebuild()
    {
        GatherDice();

        if (dice.Length == 0)
        {
            Debug.LogError("DiceBoard: no dice under " + name + ". The dice game cannot run.", this);
            return false;
        }

        PrepareDice();
        BuildCavity();
        return true;
    }

    /// <summary>
    /// Puts the two bays' dice into one list. A rig left unwired falls back to every rigidbody
    /// under this object as pip dice, which is what the game was before the colour dice existed.
    /// </summary>
    private void GatherDice()
    {
        colourDice = colourDice ?? Array.Empty<Rigidbody>();

        if (numberDice == null || numberDice.Length == 0)
        {
            var found = new List<Rigidbody>();
            foreach (var body in GetComponentsInChildren<Rigidbody>(true))
            {
                if (Array.IndexOf(colourDice, body) < 0)
                {
                    found.Add(body);
                }
            }

            numberDice = found.ToArray();
        }

        dice = new Rigidbody[numberDice.Length + colourDice.Length];
        numberDice.CopyTo(dice, 0);
        colourDice.CopyTo(dice, numberDice.Length);
    }

    private void OnDisable()
    {
        RestoreTimestep();
    }

    /// <summary>
    /// Gives each die the contact offset the rest of the rig is built to, and checks that its
    /// collider is the size of the die on screen. A box smaller than the mesh sinks the die into
    /// the floor, which the result shot is close enough to show.
    /// </summary>
    private void PrepareDice()
    {
        foreach (var die in dice)
        {
            var box = die.GetComponent<BoxCollider>();
            if (box == null)
            {
                Debug.LogWarning($"[Dice] {die.name} has no box collider.", this);
                continue;
            }

            box.contactOffset = contactOffset;

            var filter = die.GetComponent<MeshFilter>();
            if (filter == null || filter.sharedMesh == null)
            {
                continue;
            }

            Vector3 mesh = filter.sharedMesh.bounds.size;
            if (Vector3.Distance(mesh, box.size) > 0.001f)
            {
                Debug.LogWarning(
                    $"[Dice] {die.name} is {mesh.x * 1000f:0} mm across but its collider is " +
                    $"{box.size.x * 1000f:0} mm. The die will sink into whatever it lands on.",
                    this);
            }
        }
    }

    /// <summary>Hides the dice, so the cabinet stands empty between rounds.</summary>
    public void Park()
    {
        StopRoll();

        foreach (var die in dice)
        {
            die.gameObject.SetActive(false);
        }
    }

    /// <summary>
    /// Releases the dice. <paramref name="requestedResult"/> is whatever the studio sent for the
    /// stage; the physics decides the faces, so a mismatch is logged rather than forced.
    /// </summary>
    public void Roll(string requestedResult)
    {
        StopRoll();
        roll = StartCoroutine(RollRoutine(requestedResult));
    }

    /// <summary>Abandons a running roll and leaves the dice where they are.</summary>
    public void StopRoll()
    {
        if (roll != null)
        {
            StopCoroutine(roll);
            roll = null;
        }

        RestoreTimestep();
        IsRolling = false;
    }

    /// <summary>
    /// Releases every die and starts the bookkeeping a roll needs. Paired with
    /// <see cref="StepRoll"/>, which carries one roll along one physics step at a time: the
    /// coroutine below drives the pair from the show, and the physics soak drives it from the
    /// editor at whatever speed the machine manages.
    /// </summary>
    public void BeginRoll()
    {
        Release();

        lowest = new float[dice.Length];
        stalled = new float[dice.Length];
        for (int i = 0; i < dice.Length; i++)
        {
            lowest[i] = float.PositiveInfinity;
        }

        nudges = 0;
        allStillFor = 0f;
        rollElapsed = 0f;
    }

    /// <summary>
    /// Carries a running roll over one physics step, which must already have been simulated.
    /// Returns true once the roll is over, which is when every die lies still on the floor. A die
    /// still up in the field holds the roll open, so a stalled one always gets its nudge.
    /// </summary>
    public bool StepRoll(float step)
    {
        rollElapsed += step;

        bool settled = true;
        for (int i = 0; i < dice.Length; i++)
        {
            var die = dice[i];
            float height = HeightOf(die);
            bool onFloor = height <= RestHeight;

            if (!onFloor || !IsStill(die))
            {
                settled = false;
            }

            if (onFloor)
            {
                continue;
            }

            if (height < lowest[i] - stallProgress)
            {
                lowest[i] = height;
                stalled[i] = 0f;
            }
            else
            {
                stalled[i] += step;
            }

            // A die that is no longer making its way down is caught on a peg or between two.
            if (stalled[i] >= stallSeconds && nudges < maxNudges)
            {
                Nudge(die, nudges);
                lowest[i] = height;
                stalled[i] = 0f;
                nudges++;
            }
        }

        allStillFor = settled ? allStillFor + step : 0f;
        return allStillFor >= settleSeconds && rollElapsed >= minimumRollSeconds;
    }

    /// <summary>Seconds the roll on the board has been running, or ran for.</summary>
    public float RollElapsed
    {
        get { return rollElapsed; }
    }

    /// <summary>How many dice this roll has had to knock loose.</summary>
    public int Nudges
    {
        get { return nudges; }
    }

    /// <summary>True while any die is still off the floor of the cavity.</summary>
    public bool AnyDieInTheField
    {
        get
        {
            foreach (var die in dice)
            {
                if (!IsOnFloor(die))
                {
                    return true;
                }
            }

            return false;
        }
    }

    private IEnumerator RollRoutine(string requestedResult)
    {
        IsRolling = true;
        Time.fixedDeltaTime = rollTimestep;
        BeginRoll();

        while (rollElapsed < rollTimeout)
        {
            yield return new WaitForFixedUpdate();
            if (StepRoll(Time.fixedDeltaTime))
            {
                break;
            }
        }

        float elapsed = rollElapsed;
        bool timedOut = elapsed >= rollTimeout;

        ReadRoll();
        RestoreTimestep();
        IsRolling = false;
        roll = null;

        Debug.Log(
            $"[Dice] rolled {DescribeRoll()} in {elapsed:0.00}s" +
            (nudges > 0 ? $", {nudges} nudge(s)" : string.Empty) +
            (timedOut ? " (timed out, reported where they lay)" : string.Empty),
            this);

        // Only the timeout can end a roll with a die in the air, and by then it has been nudged
        // as often as the rig allows. Its face is not a real roll, so say so loudly rather than
        // paying out on it.
        foreach (var die in dice)
        {
            if (!IsOnFloor(die))
            {
                Debug.LogWarning(
                    $"[Dice] {die.name} ran the roll out {HeightOf(die) / boardScale:0.00} m up, still " +
                    $"caught in the field after {nudges} nudge(s). Its face is not a fair roll.",
                    this);
            }
        }

        if (!string.IsNullOrEmpty(requestedResult))
        {
            Debug.LogWarning(
                $"[Dice] the studio asked for '{requestedResult}' and the dice fell on {Total}. " +
                "The roll is physics only; nothing forces the studio's number yet.",
                this);
        }

        var handler = RollCompleted;
        if (handler != null)
        {
            handler(Total);
        }
    }

    /// <summary>
    /// Drops every die in at the top of the cabinet at once, each one turned differently. The two
    /// bays are released over their own lanes, so the pip dice go left and the colour dice right.
    /// </summary>
    private void Release()
    {
        ReleaseBay(numberDice, numberReleaseAcross, "pip");
        ReleaseBay(colourDice, colourReleaseAcross, "colour");
    }

    private void ReleaseBay(Rigidbody[] bay, float[] lanes, string what)
    {
        for (int i = 0; i < bay.Length; i++)
        {
            var die = bay[i];
            float across = lanes.Length > 0 ? lanes[i % lanes.Length] : 0f;
            across += UnityEngine.Random.Range(-releaseJitter, releaseJitter);

            Vector3 spawn = transform.TransformPoint(FromBoard(across, CavityMidY, releaseHeight));
            Quaternion turn = UnityEngine.Random.rotationUniform;

            die.gameObject.SetActive(true);

            // The pose goes on the body, not only on the transform. This project runs with Auto
            // Sync Transforms off, so a transform write never reaches the physics engine, and a
            // die that has already settled once is asleep on the floor: it would stay there and
            // report last round's faces as a fresh roll.
            die.position = spawn;
            die.rotation = turn;
            die.transform.SetPositionAndRotation(spawn, turn);

            die.linearVelocity = Vector3.zero;
            die.angularVelocity = UnityEngine.Random.onUnitSphere * (releaseSpin * Mathf.Deg2Rad);
            die.WakeUp();

            Debug.Log(
                $"[Dice] released {what} die {i + 1} at {die.transform.position} " +
                $"(board x={across:0.000} z={releaseHeight:0.000})",
                this);
        }
    }

    private bool IsStill(Rigidbody die)
    {
        return die.linearVelocity.magnitude < stillSpeed
            && die.angularVelocity.magnitude < stillSpinDegrees * Mathf.Deg2Rad;
    }

    /// <summary>How high a die stands over the plinth, in this object's space.</summary>
    private float HeightOf(Rigidbody die)
    {
        return transform.InverseTransformPoint(die.transform.position).y;
    }

    /// <summary>
    /// The height a die's centre is under once it lies on the floor, or on top of another die.
    /// Three dice share the wide bay's floor, so this has to clear one die standing on another.
    /// The figure is in the board's own metres, where a 30 mm die measures 24.4 mm: one on the
    /// floor reports 12 mm, two stacked 37 mm and all three stacked 61 mm, so 65 mm now covers
    /// the whole pile. It still sits well under the 90 mm a die balanced on the crown of the
    /// lowest peg of the wide bay would report, which is the case this has to tell apart.
    /// </summary>
    private float RestHeight
    {
        get { return FromBoard(0f, CavityMidY, BaseTopZ).y + 0.065f * boardScale; }
    }

    /// <summary>True once a die has reached the floor of the cavity rather than stalling on a peg.</summary>
    private bool IsOnFloor(Rigidbody die)
    {
        return HeightOf(die) <= RestHeight;
    }

    /// <summary>
    /// Knocks a stalled die loose, hard enough to fall on but not to fly. The lift comes first:
    /// a die caught on two pegs has to come off them before sideways travel does anything.
    /// Each nudge of a roll is harder than the one before, so a die that shrugs the first one off
    /// still ends up on the floor.
    /// </summary>
    private void Nudge(Rigidbody die, int alreadyNudged)
    {
        float strength = 1f + 0.5f * alreadyNudged;
        Vector3 sideways = transform.right * (UnityEngine.Random.value < 0.5f ? -1f : 1f);
        die.AddForce((sideways * 0.5f + Vector3.up * 0.35f) * (strength * die.mass), ForceMode.Impulse);
        die.AddTorque(UnityEngine.Random.onUnitSphere * (0.0006f * strength * die.mass), ForceMode.Impulse);
        die.WakeUp();
        Debug.Log(
            $"[Dice] {die.name} stalled {HeightOf(die) / boardScale:0.00} m up and has been nudged " +
            $"loose (nudge {alreadyNudged + 1})",
            this);
    }

    /// <summary>Puts the timestep back to the one the rest of the show runs on.</summary>
    private void RestoreTimestep()
    {
        if (restingTimestep > 0f)
        {
            Time.fixedDeltaTime = restingTimestep;
        }
    }

    /// <summary>Reads the faces and the colours the dice are showing where they lie.</summary>
    public void ReadRoll()
    {
        var faces = new int[numberDice.Length];
        for (int i = 0; i < numberDice.Length; i++)
        {
            faces[i] = FaceUp(numberDice[i].transform);
        }

        var colours = new DieColour[colourDice.Length];
        for (int i = 0; i < colourDice.Length; i++)
        {
            colours[i] = ColourUp(colourDice[i].transform);
        }

        Faces = faces;
        Colours = colours;
    }

    /// <summary>The face of a pip die pointing most nearly straight up.</summary>
    public static int FaceUp(Transform die)
    {
        int best = 0;
        float bestDot = float.NegativeInfinity;
        for (int i = 0; i < FaceAxes.Length; i++)
        {
            float dot = Vector3.Dot(die.rotation * FaceAxes[i], Vector3.up);
            if (dot > bestDot)
            {
                bestDot = dot;
                best = i;
            }
        }

        return FaceValues[best];
    }

    /// <summary>
    /// The colour of a colour die pointing most nearly straight up. A colour sits on both ends of
    /// its axis, so the axis lying nearest to vertical carries the face on top whichever way up
    /// the die came to rest.
    /// </summary>
    public static DieColour ColourUp(Transform die)
    {
        int best = 0;
        float bestDot = float.NegativeInfinity;
        for (int i = 0; i < ColourAxes.Length; i++)
        {
            float dot = Mathf.Abs(Vector3.Dot(die.rotation * ColourAxes[i], Vector3.up));
            if (dot > bestDot)
            {
                bestDot = dot;
                best = i;
            }
        }

        return ColourValues[best];
    }

    /// <summary>The pip faces as "3 + 5 + 2", for the console and the debug panel.</summary>
    public string DescribeFaces()
    {
        if (Faces.Length == 0)
        {
            return "<no roll yet>";
        }

        var parts = new string[Faces.Length];
        for (int i = 0; i < Faces.Length; i++)
        {
            parts[i] = Faces[i].ToString();
        }

        return string.Join(" + ", parts);
    }

    /// <summary>The colours as "RED + GREEN", in release order.</summary>
    public string DescribeColours()
    {
        if (Colours.Length == 0)
        {
            return "<none>";
        }

        var parts = new string[Colours.Length];
        for (int i = 0; i < Colours.Length; i++)
        {
            parts[i] = Colours[i].ToString().ToUpperInvariant();
        }

        return string.Join(" + ", parts);
    }

    /// <summary>The whole roll, both bays, as the result screen reads it out.</summary>
    public string DescribeRoll()
    {
        if (Faces.Length == 0 && Colours.Length == 0)
        {
            return "<no roll yet>";
        }

        if (Colours.Length == 0)
        {
            return $"{DescribeFaces()} = {Total}";
        }

        return $"{DescribeFaces()} = {Total}, {DescribeColours()}";
    }

    // ------------------------------------------------------------------ cavity --

    /// <summary>
    /// Builds the colliders of the play cavity: walls, floor, deck, every peg and every
    /// deflector bar. Safe to call again — the whole group is thrown away and rebuilt.
    /// </summary>
    [ContextMenu("Rebuild cavity colliders")]
    public void BuildCavity()
    {
        var stale = transform.Find(CavityName);
        if (stale != null)
        {
            if (Application.isPlaying)
            {
                Destroy(stale.gameObject);
            }
            else
            {
                DestroyImmediate(stale.gameObject);
            }
        }

        var root = new GameObject(CavityName);
        root.transform.SetParent(transform, false);
        cavity = root.transform;

        int walls = BuildShell();
        int pegs = BuildPegs();
        int bars = BuildDeflectors();

        Debug.Log(
            $"[Dice] cavity rebuilt: {walls} walls, {pegs} pegs, {bars} deflector bars, " +
            $"play area {(W - 2f * TSide) * boardScale:0.00} x " +
            $"{(DeckBottomZ - BaseTopZ) * boardScale:0.00} x {CavityDepth * boardScale:0.00} m " +
            $"across both bays",
            this);
    }

    /// <summary>The box the dice cannot leave: two glazed faces, two sides, mullion, floor, deck.</summary>
    private int BuildShell()
    {
        float midZ = (BaseTopZ + DeckBottomZ) / 2f;
        float height = DeckBottomZ - BaseTopZ;

        // Each wall is grown outwards from the face the dice touch, so the cavity keeps its
        // true size however thick the collider is.
        AddBox("Wall_Front", 0f, CavityFrontY - WallHalf, midZ, W + 4f * WallHalf, 2f * WallHalf, height);
        AddBox("Wall_Back", 0f, CavityBackY + WallHalf, midZ, W + 4f * WallHalf, 2f * WallHalf, height);
        AddBox("Wall_Left", X0 + TSide - WallHalf, CavityMidY, midZ, 2f * WallHalf, CavityDepth, height);
        AddBox("Wall_Right", X1 - TSide + WallHalf, CavityMidY, midZ, 2f * WallHalf, CavityDepth, height);
        AddBox("Mullion", MullionX, CavityMidY, midZ, MullionW, CavityDepth, height);
        AddBox("Floor", 0f, CavityMidY, BaseTopZ - WallHalf, W, CavityDepth, 2f * WallHalf);
        AddBox("Deck", 0f, CavityMidY, DeckBottomZ + WallHalf, W, CavityDepth, 2f * WallHalf);

        // The bottom rails clamp the glass and stand a little proud of it inside the cavity, so a
        // die that comes to rest against the glass leans on the rail rather than through it.
        AddBox(
            "Rail_Front", 0f, (CavityFrontY + RailFrontY) / 2f, (BaseTopZ + RailTopZ) / 2f,
            W, RailFrontY - CavityFrontY, RailTopZ - BaseTopZ);
        AddBox(
            "Rail_Back", 0f, (CavityBackY + RailBackY) / 2f, (BaseTopZ + RailTopZ) / 2f,
            W, CavityBackY - RailBackY, RailTopZ - BaseTopZ);
        return 9;
    }

    /// <summary>One capsule per peg, reaching from the front sheet to the back sheet.</summary>
    private int BuildPegs()
    {
        int count = 0;

        // Right bay: three columns of nineteen fat pegs.
        float[] columns = { RightBayX0 + 0.078f, (RightBayX0 + RightBayX1) / 2f, RightBayX1 - 0.078f };
        for (int row = 0; row < 19; row++)
        {
            float z = 0.175f + row * 0.107f;
            foreach (float x in columns)
            {
                AddPeg($"Peg_R_{row}_{count}", x, z, 0.026f);
                count++;
            }
        }

        // Wide bay, middle field: five short rows of medium pegs.
        float[][] midRows =
        {
            new[] { 1.478f, 6f, 0.000f }, new[] { 1.404f, 6f, 0.052f }, new[] { 1.330f, 4f, 0.104f },
            new[] { 1.048f, 5f, 0.026f }, new[] { 0.988f, 5f, 0.078f },
        };
        foreach (var row in midRows)
        {
            for (int i = 0; i < (int)row[1]; i++)
            {
                float x = -0.470f + row[2] + i * 0.104f;
                if (x > LeftBayX1 - 0.030f)
                {
                    continue;
                }

                AddPeg($"Peg_M_{count}", x, row[0], 0.018f);
                count++;
            }
        }

        // Wide bay, lower field: nine staggered rows of small pegs.
        for (int row = 0; row < 9; row++)
        {
            float z = 0.155f + row * 0.093f;
            float offset = row % 2 != 0 ? 0.043f : 0f;
            for (int i = 0; i < 7; i++)
            {
                float x = -0.480f + offset + i * 0.086f;
                if (x > LeftBayX1 - 0.026f)
                {
                    continue;
                }

                AddPeg($"Peg_L_{count}", x, z, 0.0135f);
                count++;
            }
        }

        return count;
    }

    /// <summary>
    /// The chevrons, pentagons and diamonds of the wide bay. Each outline is a run of straight
    /// bars, so each bar is one box turned to lie along its own segment.
    /// </summary>
    private int BuildDeflectors()
    {
        int bars = 0;
        var pentagon = Pentagon();

        // Five rows across the upper field, the same rows the generator sweeps.
        foreach (var row in ShapeRows)
        {
            bool pentagons = row.Pentagons;
            foreach (float x in row.Across)
            {
                bars += AddOutline(pentagons ? pentagon : Chevron, x, row.Height, 0f, 1f, pentagons);
            }
        }

        // Tilted chevrons on the bay walls, which turn a die back off the glass.
        foreach (float z in new[] { 2.045f, 1.812f })
        {
            bars += AddOutline(Chevron, -0.516f, z, -72f, 0.92f, false);
            bars += AddOutline(Chevron, 0.104f, z, 72f, 0.92f, false);
        }

        // The two big diamonds, each with its hub at the centre.
        for (int i = 0; i < Diamonds.Length; i++)
        {
            var d = Diamonds[i];
            bars += AddOutline(Diamond, d.x, d.y, d.z, 1f, true);
            AddPeg($"Hub_{i}", d.x, d.y, 0.026f);
        }

        return bars;
    }

    private static Vector2[] Pentagon()
    {
        var points = new Vector2[5];
        for (int i = 0; i < 5; i++)
        {
            float a = (90f + i * 72f) * Mathf.Deg2Rad;
            points[i] = new Vector2(0.048f * Mathf.Cos(a), 0.048f * Mathf.Sin(a));
        }

        return points;
    }

    /// <summary>Lays one box along every segment of an outline placed at (cx, cz).</summary>
    private int AddOutline(Vector2[] profile, float cx, float cz, float rotation, float scale, bool closed)
    {
        float a = rotation * Mathf.Deg2Rad;
        float ca = Mathf.Cos(a);
        float sa = Mathf.Sin(a);

        var points = new Vector2[profile.Length];
        for (int i = 0; i < profile.Length; i++)
        {
            Vector2 p = profile[i] * scale;
            points[i] = new Vector2(cx + p.x * ca - p.y * sa, cz + p.x * sa + p.y * ca);
        }

        int segments = closed ? points.Length : points.Length - 1;
        for (int i = 0; i < segments; i++)
        {
            AddBar(points[i], points[(i + 1) % points.Length]);
        }

        return segments;
    }

    /// <summary>One bar of an outline: a box turned to lie between two points of the board's face.</summary>
    private void AddBar(Vector2 from, Vector2 to)
    {
        Vector3 a = FromBoard(from.x, CavityMidY, from.y);
        Vector3 b = FromBoard(to.x, CavityMidY, to.y);
        Vector3 along = b - a;

        var go = new GameObject("Bar");
        go.transform.SetParent(cavity, false);
        go.transform.localPosition = (a + b) * 0.5f;
        go.transform.localRotation = Quaternion.AngleAxis(
            Mathf.Atan2(along.y, along.x) * Mathf.Rad2Deg, Vector3.forward);

        var box = go.AddComponent<BoxCollider>();
        box.size = new Vector3(
            along.magnitude + BarWidth * boardScale,
            BarWidth * boardScale,
            CavityDepth * boardScale);
        box.sharedMaterial = surface;
        box.contactOffset = contactOffset;
    }

    private void AddPeg(string name, float x, float z, float radius)
    {
        var go = new GameObject(name);
        go.transform.SetParent(cavity, false);
        go.transform.localPosition = FromBoard(x, CavityMidY, z);

        var capsule = go.AddComponent<CapsuleCollider>();
        capsule.direction = 2;                       // through the cabinet, front to back
        capsule.radius = radius * boardScale;
        capsule.height = CavityDepth * boardScale;
        capsule.sharedMaterial = surface;
        capsule.contactOffset = contactOffset;
    }

    private void AddBox(string name, float x, float y, float z, float sizeX, float sizeY, float sizeZ)
    {
        var go = new GameObject(name);
        go.transform.SetParent(cavity, false);
        go.transform.localPosition = FromBoard(x, y, z);

        var box = go.AddComponent<BoxCollider>();
        box.size = new Vector3(sizeX, sizeZ, sizeY) * boardScale;
        box.sharedMaterial = surface;
        box.contactOffset = contactOffset;
    }

    /// <summary>
    /// A point of the board's own space, in this object's space. Unity's FBX import mirrors X and
    /// the model is authored Z-up, so a Blender point (x, y, z) lands at (-x, z, -y) here, at the
    /// size the cabinet was placed at.
    /// </summary>
    private Vector3 FromBoard(float x, float y, float z)
    {
        return new Vector3(-x, z, -y) * boardScale;
    }
}
