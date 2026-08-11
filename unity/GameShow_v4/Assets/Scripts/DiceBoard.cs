using System;
using System.Collections;
using UnityEngine;

/// <summary>
/// The bonus dice game. Two dice are released at the top of the acrylic cabinet, fall through
/// its deflector and peg fields, and come to rest on its floor. The faces that end up on top
/// are the roll.
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
/// The dice fall down the narrow bay, the one with three columns of fat pegs. Its gaps are even
/// and wide enough for a 36 mm die at any angle. The wide bay's chevron, pentagon and diamond
/// rows are pitched for a far smaller ball — a die released over them wedges between two rows and
/// never reaches the floor — so the wide bay is scenery for this game, not a route.
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
    private const float BaseTopZ = 0.075f;       // floor of the play area
    private const float DeckBottomZ = 2.287f;    // underside of the top deck: its ceiling
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

    [Header("Wiring")]
    [Tooltip("The two dice. Left empty, every rigidbody under this object is used.")]
    [SerializeField] private Rigidbody[] dice;

    [Tooltip("Surface of the cavity walls, pegs and deflectors. Acrylic, so fairly lively.")]
    [SerializeField] private PhysicsMaterial surface;

    [Tooltip(
        "Size the cabinet is placed at in the scene, so the board's own metres become scene " +
        "metres. Read off the BonusDice root, whose scale is 122.98 against a model in centimetres.")]
    [SerializeField, Min(0.01f)] private float boardScale = 1.2298f;

    [Header("Release")]
    [Tooltip("Height inside the cabinet the dice are released from, in the board's own metres.")]
    [SerializeField] private float releaseHeight = 2.2f;

    [Tooltip(
        "Where across the cabinet each die is released, in the board's own metres. Both sit over " +
        "the narrow bay, one above each channel between its three columns of pegs. The wide bay " +
        "is not used: its deflector rows are pitched for a small ball and a die wedges in them.")]
    [SerializeField] private float[] releaseAcross = { 0.286f, 0.407f };

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

    [Tooltip("Seconds a die may sit still off the floor before it is nudged loose.")]
    [SerializeField, Min(0.1f)] private float wedgeSeconds = 0.7f;

    [Tooltip("Never nudge more than this many times per roll; something is wrong past that.")]
    [SerializeField, Min(0)] private int maxNudges = 8;

    [Tooltip("Seconds a roll may run before it is reported done wherever the dice are.")]
    [SerializeField, Min(1f)] private float rollTimeout = 14f;

    /// <summary>True from the release until every die has settled, timed out or been stopped.</summary>
    public bool IsRolling { get; private set; }

    /// <summary>The face each die shows, in release order. Empty before the first roll.</summary>
    public int[] Faces { get; private set; } = Array.Empty<int>();

    /// <summary>The two faces added together, which is what a dice round pays on.</summary>
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

    private void Awake()
    {
        if (dice == null || dice.Length == 0)
        {
            dice = GetComponentsInChildren<Rigidbody>(true);
        }

        if (dice.Length == 0)
        {
            Debug.LogError("DiceBoard: no dice under " + name + ". The dice game cannot run.", this);
            enabled = false;
            return;
        }

        BuildCavity();
        Park();
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

        IsRolling = false;
    }

    private IEnumerator RollRoutine(string requestedResult)
    {
        IsRolling = true;
        Release();

        var stillFor = new float[dice.Length];
        int nudges = 0;
        float allStillFor = 0f;
        float started = Time.time;

        while (Time.time - started < rollTimeout)
        {
            yield return new WaitForFixedUpdate();

            bool allStill = true;
            for (int i = 0; i < dice.Length; i++)
            {
                if (IsStill(dice[i]))
                {
                    stillFor[i] += Time.fixedDeltaTime;
                }
                else
                {
                    stillFor[i] = 0f;
                    allStill = false;
                }

                // A die that has stopped without reaching the floor is caught between pegs.
                if (stillFor[i] > wedgeSeconds && !IsOnFloor(dice[i]) && nudges < maxNudges)
                {
                    Nudge(dice[i]);
                    stillFor[i] = 0f;
                    nudges++;
                    allStill = false;
                }
            }

            allStillFor = allStill ? allStillFor + Time.fixedDeltaTime : 0f;
            if (allStillFor >= settleSeconds && Time.time - started >= minimumRollSeconds)
            {
                break;
            }
        }

        float elapsed = Time.time - started;
        bool timedOut = elapsed >= rollTimeout;

        ReadFaces();
        IsRolling = false;
        roll = null;

        Debug.Log(
            $"[Dice] rolled {DescribeFaces()} = {Total} in {elapsed:0.00}s" +
            (nudges > 0 ? $", {nudges} nudge(s)" : string.Empty) +
            (timedOut ? " (timed out, reported where they lay)" : string.Empty),
            this);

        // A face read off a die still hanging in the field is not a real roll, so say so
        // loudly rather than paying out on it.
        foreach (var die in dice)
        {
            if (!IsOnFloor(die))
            {
                Debug.LogWarning(
                    $"[Dice] {die.name} stopped {transform.InverseTransformPoint(die.transform.position).y:0.00} m up, " +
                    "wedged in the field instead of reaching the floor. Its face is not a fair roll — " +
                    "the die is too big for the gaps it was released over.",
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

    /// <summary>Drops the dice in at the top of the cabinet, each one turned differently.</summary>
    private void Release()
    {
        for (int i = 0; i < dice.Length; i++)
        {
            var die = dice[i];
            float across = releaseAcross.Length > 0
                ? releaseAcross[i % releaseAcross.Length]
                : 0f;
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
                $"[Dice] released die {i + 1} at {die.transform.position} " +
                $"(board x={across:0.000} z={releaseHeight:0.000})",
                this);
        }
    }

    private bool IsStill(Rigidbody die)
    {
        return die.linearVelocity.magnitude < stillSpeed
            && die.angularVelocity.magnitude < stillSpinDegrees * Mathf.Deg2Rad;
    }

    /// <summary>True once a die has reached the floor of the cavity rather than stalling on a peg.</summary>
    private bool IsOnFloor(Rigidbody die)
    {
        float restHeight = FromBoard(0f, CavityMidY, BaseTopZ).y + 0.05f * boardScale;
        return transform.InverseTransformPoint(die.transform.position).y <= restHeight;
    }

    /// <summary>
    /// Knocks a wedged die loose, hard enough to fall on but not to fly. The lift comes first:
    /// a die caught on two pegs has to come off them before sideways travel does anything.
    /// </summary>
    private void Nudge(Rigidbody die)
    {
        Vector3 sideways = transform.right * (UnityEngine.Random.value < 0.5f ? -1f : 1f);
        die.AddForce((sideways * 0.7f + Vector3.up * 0.5f) * die.mass, ForceMode.Impulse);
        die.AddTorque(UnityEngine.Random.onUnitSphere * (0.004f * die.mass), ForceMode.Impulse);
        Debug.Log($"[Dice] {die.name} was wedged off the floor and has been nudged", this);
    }

    private void ReadFaces()
    {
        var faces = new int[dice.Length];
        for (int i = 0; i < dice.Length; i++)
        {
            faces[i] = FaceUp(dice[i].transform);
        }

        Faces = faces;
    }

    /// <summary>The face of a die pointing most nearly straight up.</summary>
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

    /// <summary>The faces as "3 + 5", for the console and the debug panel.</summary>
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
        return 7;
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
    }

    private void AddBox(string name, float x, float y, float z, float sizeX, float sizeY, float sizeZ)
    {
        var go = new GameObject(name);
        go.transform.SetParent(cavity, false);
        go.transform.localPosition = FromBoard(x, y, z);

        var box = go.AddComponent<BoxCollider>();
        box.size = new Vector3(sizeX, sizeZ, sizeY) * boardScale;
        box.sharedMaterial = surface;
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
