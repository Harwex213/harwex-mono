using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// One position on a reel. A position shows either a number or one of the three symbols, never
/// both, so <see cref="kind"/> decides which of <see cref="displayText"/> and
/// <see cref="sprite"/> the view draws.
/// </summary>
[Serializable]
public class SlotReelItem
{
    [Tooltip("Stable name for this position. Used by the forced-result API and by the logs, so " +
             "keep it unique inside its reel and do not rename it to change what is displayed.")]
    public string id = "item";

    [Tooltip("What a Value position prints. Ignored by a Symbol position.")]
    public string displayText = "0";

    [Tooltip("Whether this position prints a number or draws a symbol.")]
    public SlotReelItemKind kind = SlotReelItemKind.Value;

    [Tooltip("Which symbol a Symbol position draws. Also what the paytable matches on.")]
    public SlotSymbolId symbol = SlotSymbolId.Star;

    [Tooltip("Sprite for a Symbol position. A Value position leaves this empty.")]
    public Sprite sprite;

    [Tooltip("Relative chance of a random spin landing here. 0 takes the position out of the draw " +
             "without removing it from the strip.")]
    [Min(0f)] public float weight = 1f;

    [Tooltip("What this position multiplies a win by. The paytable can use it instead of its own " +
             "multiplier, which is how a value triple pays what the number says.")]
    public float multiplier = 1f;

    [Tooltip("Flat reward this position adds, in whatever unit the show counts in.")]
    public int reward;

    [Tooltip("Tint the number or symbol away from the reel's own accent colour.")]
    public bool overrideColor;

    public Color color = Color.white;

    /// <summary>True when this position shows <paramref name="id"/>.</summary>
    public bool IsSymbol(SlotSymbolId id)
    {
        return kind == SlotReelItemKind.Symbol && symbol == id;
    }

    public override string ToString()
    {
        return kind == SlotReelItemKind.Symbol ? symbol.ToString() : displayText;
    }
}

/// <summary>
/// Everything one of the three reels carries: its backdrop, its accent colour and the ordered
/// list of positions it turns through. The order is the order they scroll past, so it is what the
/// player reads, not just a set.
/// </summary>
[Serializable]
public class SlotReelStrip
{
    [Tooltip("Name for the inspector and the logs, such as Left (red).")]
    public string name = "Reel";

    [Tooltip("Opaque backdrop behind the scrolling content.")]
    public Sprite background;

    [Tooltip("Colour the numbers take unless a position overrides it.")]
    public Color accentColor = new Color(1f, 0.86f, 0.45f, 1f);

    [Tooltip("The positions, top to bottom as they appear at rest. The first four are what the " +
             "cabinet reference paints, and the rest are what makes every paytable line reachable.")]
    public List<SlotReelItem> items = new List<SlotReelItem>();

    public int Count
    {
        get { return items == null ? 0 : items.Count; }
    }

    public SlotReelItem this[int index]
    {
        get { return items[Wrap(index)]; }
    }

    /// <summary>Maps any integer onto a real position, so a scroll offset never needs clamping.</summary>
    public int Wrap(int index)
    {
        int count = Count;
        if (count <= 0)
        {
            return 0;
        }

        int wrapped = index % count;
        return wrapped < 0 ? wrapped + count : wrapped;
    }

    /// <summary>Draws a position using the weights. Returns -1 only when the strip is empty.</summary>
    public int DrawWeightedIndex(System.Random random)
    {
        int count = Count;
        if (count == 0)
        {
            return -1;
        }

        float total = 0f;
        for (int i = 0; i < count; i++)
        {
            total += Mathf.Max(0f, items[i].weight);
        }

        if (total <= 0f)
        {
            // Every weight is zero, so nothing is more likely than anything else.
            return random.Next(count);
        }

        float roll = (float)random.NextDouble() * total;
        for (int i = 0; i < count; i++)
        {
            roll -= Mathf.Max(0f, items[i].weight);
            if (roll <= 0f)
            {
                return i;
            }
        }

        return count - 1;
    }

    /// <summary>First position whose <c>id</c> matches, or -1. Lets a show name an outcome.</summary>
    public int IndexOfId(string id)
    {
        for (int i = 0; i < Count; i++)
        {
            if (string.Equals(items[i].id, id, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>First position showing <paramref name="symbol"/>, or -1.</summary>
    public int IndexOfSymbol(SlotSymbolId symbol)
    {
        for (int i = 0; i < Count; i++)
        {
            if (items[i].IsSymbol(symbol))
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>First position printing <paramref name="value"/>, or -1.</summary>
    public int IndexOfValue(string value)
    {
        for (int i = 0; i < Count; i++)
        {
            var item = items[i];
            if (item.kind == SlotReelItemKind.Value &&
                string.Equals(item.displayText, value, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        return -1;
    }
}
