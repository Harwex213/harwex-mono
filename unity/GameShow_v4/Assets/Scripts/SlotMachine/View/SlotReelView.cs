using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Draws one reel. Given a scroll position in strip positions, it puts the right item in the right
/// place inside the viewport mask.
///
/// The reel is modelled as an endless ribbon: ribbon cell <c>j</c> shows strip position
/// <c>j mod count</c>, and ribbon cell <c>j</c> sits at <c>viewportTop - ((j - position) + 0.5) *
/// cellHeight</c>. Scrolling is therefore just a growing <c>position</c>, with no special case at
/// the seam, and the visible position on the win line is always
/// <c>round(position) + winLineCell</c>. Two spare cells above and below the visible ones keep the
/// ribbon covered while a cell is half out of the mask.
///
/// The cell objects are built once and reused for ever after. Nothing is created, destroyed or
/// allocated per frame, and a cell's text and sprite are only touched when the position it shows
/// actually changes, so a spinning reel costs a batch, not a Canvas rebuild.
/// </summary>
[DisallowMultipleComponent]
public class SlotReelView : MonoBehaviour
{
    /// <summary>Spare cells kept beyond the visible ones, one above and one below.</summary>
    private const int OverscanCells = 2;

    [Header("Layers")]
    [Tooltip("The masked area. Its height divided by the visible count is one position's height.")]
    [SerializeField] private RectTransform viewport;

    [Tooltip("Holds the cells. Moves nothing itself; the cells are placed individually.")]
    [SerializeField] private RectTransform scrollingContent;

    [Tooltip("Opaque backdrop for this reel.")]
    [SerializeField] private Image background;

    [Tooltip("Warm band over the win line. Brightens on a win.")]
    [SerializeField] private Image centerHighlight;

    [Tooltip("Darkening at the top and bottom edges of the viewport.")]
    [SerializeField] private Image edgeShadow;

    [Tooltip("Streak that reads as a reflection in the display glass.")]
    [SerializeField] private Image glassReflection;

    [Header("Cell layout")]
    [Tooltip("Height of a number, as a fraction of one position's height.")]
    [SerializeField, Range(0.2f, 1f)] private float valueHeightFraction = 0.70f;

    [Tooltip("Shared TextMeshPro material for the numbers, carrying the dark rim the cabinet " +
             "reference paints. One material for all cells, so the reels stay in a single batch. " +
             "Left empty, the font's own material is used and the numbers have no rim.")]
    [SerializeField] private Material numberMaterial;

    [Tooltip("Size of a symbol, as a fraction of the smaller of the position's width and height.")]
    [SerializeField, Range(0.2f, 1.2f)] private float symbolSizeFraction = 0.82f;

    [Header("Built cells")]
    [Tooltip("Filled in when the reel is configured. Authored into the prefab so nothing is " +
             "created while the game runs.")]
    [SerializeField] private List<SlotReelCell> cells = new List<SlotReelCell>();

    private SlotReelStrip _strip;
    private int _visibleCells = 4;
    private int _winLineCell = 2;
    private float _highlightRest;
    private float _punch;

    /// <summary>One reusable cell: a number and a symbol, of which one is shown at a time.</summary>
    [System.Serializable]
    public class SlotReelCell
    {
        public RectTransform root;
        public TMP_Text value;
        public Image symbol;

        [Tooltip("Strip position this cell currently shows. -1 forces the next refresh to redraw it.")]
        public int shownIndex = -1;
    }

    public RectTransform Viewport { get { return viewport; } }
    public int CellCount { get { return cells.Count; } }

    /// <summary>Height of one strip position, in this canvas's units.</summary>
    public float CellHeight
    {
        get
        {
            if (viewport == null || _visibleCells <= 0)
            {
                return 0f;
            }

            return viewport.rect.height / _visibleCells;
        }
    }

    /// <summary>Where the win line sits, measured from the middle of the viewport.</summary>
    public float WinLineOffset
    {
        get
        {
            if (viewport == null)
            {
                return 0f;
            }

            return viewport.rect.height * 0.5f - (_winLineCell + 0.5f) * CellHeight;
        }
    }

    /// <summary>
    /// Points the view at a strip and lays out the cells for it. Builds or trims the cell objects
    /// if the visible count changed, which only happens in the editor or on the first run.
    /// </summary>
    public void Configure(SlotMachineConfig config, SlotReelStrip strip)
    {
        _strip = strip;
        if (config != null)
        {
            _visibleCells = Mathf.Max(1, config.VisibleCells);
            _winLineCell = config.WinLineCell;
            _highlightRest = centerHighlight == null ? 0f : centerHighlight.color.a;
        }

        if (background != null && strip != null && strip.background != null)
        {
            background.sprite = strip.background;
        }

        EnsureCells(_visibleCells + OverscanCells);
        LayoutCellSizes();
        InvalidateCells();
        SetScroll(0f);
        SetWinHighlight(0f);
    }

    /// <summary>Puts the reel at <paramref name="position"/>, measured in strip positions.</summary>
    public void SetScroll(float position)
    {
        if (viewport == null || cells.Count == 0)
        {
            return;
        }

        float cellHeight = CellHeight;
        float top = viewport.rect.height * 0.5f;
        int firstRibbon = Mathf.FloorToInt(position) - 1;
        int winRibbon = Mathf.RoundToInt(position) + _winLineCell;

        for (int k = 0; k < cells.Count; k++)
        {
            var cell = cells[k];
            if (cell == null || cell.root == null)
            {
                continue;
            }

            int ribbon = firstRibbon + k;
            float y = top - ((ribbon - position) + 0.5f) * cellHeight;
            cell.root.anchoredPosition = new Vector2(0f, y);

            int index = _strip == null ? 0 : _strip.Wrap(ribbon);
            if (cell.shownIndex != index)
            {
                Draw(cell, index);
            }

            // Only the position actually on the win line takes the win punch.
            float scale = _punch > 0f && ribbon == winRibbon ? 1f + _punch : 1f;
            cell.root.localScale = new Vector3(scale, scale, 1f);
        }
    }

    /// <summary>Raises the win-line band. 0 is the resting glow, 1 is a matched reel.</summary>
    public void SetWinHighlight(float amount)
    {
        if (centerHighlight == null)
        {
            return;
        }

        var color = centerHighlight.color;
        color.a = Mathf.Lerp(_highlightRest, 1f, Mathf.Clamp01(amount));
        centerHighlight.color = color;
    }

    /// <summary>How much the item on the win line grows. Applied on the next <see cref="SetScroll"/>.</summary>
    public void SetPunch(float amount)
    {
        _punch = Mathf.Max(0f, amount);
    }

    /// <summary>Forces every cell to redraw, after the strip contents changed.</summary>
    public void InvalidateCells()
    {
        for (int i = 0; i < cells.Count; i++)
        {
            if (cells[i] != null)
            {
                cells[i].shownIndex = -1;
            }
        }
    }

    /// <summary>What this reel is missing, appended to <paramref name="problems"/>.</summary>
    public void CollectProblems(List<string> problems, string label)
    {
        if (viewport == null)
        {
            problems.Add(label + ": no Viewport.");
        }
        else if (viewport.GetComponent<RectMask2D>() == null)
        {
            problems.Add(label + ": Viewport has no RectMask2D, so the reel will spill out of the window.");
        }

        if (scrollingContent == null)
        {
            problems.Add(label + ": no ScrollingContent.");
        }

        if (background == null)
        {
            problems.Add(label + ": no Background image.");
        }

        for (int i = 0; i < cells.Count; i++)
        {
            var cell = cells[i];
            if (cell == null || cell.root == null || cell.value == null || cell.symbol == null)
            {
                problems.Add(label + ": cell " + i + " is incomplete.");
            }
        }
    }

    private void Draw(SlotReelCell cell, int index)
    {
        cell.shownIndex = index;
        if (_strip == null || _strip.Count == 0)
        {
            cell.value.enabled = false;
            cell.symbol.enabled = false;
            return;
        }

        var item = _strip[index];
        bool isSymbol = item.kind == SlotReelItemKind.Symbol;
        cell.value.enabled = !isSymbol;
        cell.symbol.enabled = isSymbol;

        if (isSymbol)
        {
            cell.symbol.sprite = item.sprite;
            cell.symbol.color = item.overrideColor ? item.color : Color.white;
        }
        else
        {
            cell.value.text = item.displayText;
            cell.value.color = item.overrideColor ? item.color : _strip.accentColor;
        }
    }

    private void EnsureCells(int wanted)
    {
        if (scrollingContent == null)
        {
            return;
        }

        while (cells.Count > wanted)
        {
            var extra = cells[cells.Count - 1];
            cells.RemoveAt(cells.Count - 1);
            if (extra != null && extra.root != null)
            {
                DestroyCell(extra.root.gameObject);
            }
        }

        while (cells.Count < wanted)
        {
            cells.Add(BuildCell(cells.Count));
        }
    }

    private SlotReelCell BuildCell(int index)
    {
        var root = new GameObject("Cell_" + index, typeof(RectTransform)).GetComponent<RectTransform>();
        root.SetParent(scrollingContent, false);
        root.anchorMin = new Vector2(0.5f, 0.5f);
        root.anchorMax = new Vector2(0.5f, 0.5f);
        root.pivot = new Vector2(0.5f, 0.5f);

        var valueGo = new GameObject("Value", typeof(RectTransform));
        valueGo.transform.SetParent(root, false);
        var value = valueGo.AddComponent<TextMeshProUGUI>();
        value.alignment = TextAlignmentOptions.Center;
        value.textWrappingMode = TextWrappingModes.NoWrap;
        value.overflowMode = TextOverflowModes.Overflow;
        value.raycastTarget = false;
        value.fontStyle = FontStyles.Bold;
        if (numberMaterial != null)
        {
            value.fontSharedMaterial = numberMaterial;
        }

        var symbolGo = new GameObject("Symbol", typeof(RectTransform));
        symbolGo.transform.SetParent(root, false);
        var symbol = symbolGo.AddComponent<Image>();
        symbol.raycastTarget = false;
        symbol.preserveAspect = true;

        return new SlotReelCell { root = root, value = value, symbol = symbol, shownIndex = -1 };
    }

    private static void DestroyCell(GameObject go)
    {
        if (Application.isPlaying)
        {
            Destroy(go);
        }
        else
        {
            DestroyImmediate(go);
        }
    }

    private void LayoutCellSizes()
    {
        if (viewport == null)
        {
            return;
        }

        float width = viewport.rect.width;
        float cellHeight = CellHeight;
        float symbolSize = Mathf.Min(width, cellHeight) * symbolSizeFraction;

        for (int i = 0; i < cells.Count; i++)
        {
            var cell = cells[i];
            if (cell == null || cell.root == null)
            {
                continue;
            }

            cell.root.sizeDelta = new Vector2(width, cellHeight);

            if (cell.value != null)
            {
                var rect = (RectTransform)cell.value.transform;
                Stretch(rect);
                cell.value.fontSize = cellHeight * valueHeightFraction;
            }

            if (cell.symbol != null)
            {
                var rect = (RectTransform)cell.symbol.transform;
                rect.anchorMin = new Vector2(0.5f, 0.5f);
                rect.anchorMax = new Vector2(0.5f, 0.5f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                rect.anchoredPosition = Vector2.zero;
                rect.sizeDelta = new Vector2(symbolSize, symbolSize);
            }
        }

        // The highlight follows the win line, which is not the middle of the viewport when an even
        // number of positions is visible.
        if (centerHighlight != null)
        {
            var rect = (RectTransform)centerHighlight.transform;
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = new Vector2(0f, WinLineOffset);
            rect.sizeDelta = new Vector2(width, cellHeight * 1.6f);
        }

        if (edgeShadow != null)
        {
            Stretch((RectTransform)edgeShadow.transform);
        }

        if (glassReflection != null)
        {
            Stretch((RectTransform)glassReflection.transform);
        }
    }

    private static void Stretch(RectTransform rect)
    {
        rect.anchorMin = Vector2.zero;
        rect.anchorMax = Vector2.one;
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.offsetMin = Vector2.zero;
        rect.offsetMax = Vector2.zero;
    }
}
