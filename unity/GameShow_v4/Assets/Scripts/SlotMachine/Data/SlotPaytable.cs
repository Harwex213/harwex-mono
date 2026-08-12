using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// One line of the paytable. What it matches on is <see cref="kind"/>, and each kind reads a
/// different one of the fields below, so most of them are blank on any given line.
/// </summary>
[Serializable]
public class SlotWinCombination
{
    [Tooltip("Stable name reported on the result, such as three_stars. The show reads this, so " +
             "renaming one is an API change.")]
    public string id = "combination";

    [Tooltip("Which of the fields below decide the match.")]
    public SlotMatchKind kind = SlotMatchKind.AnySymbolTriple;

    [Tooltip("SymbolTriple only: the symbol all three reels must show.")]
    public SlotSymbolId symbol = SlotSymbolId.Star;

    [Tooltip("ExactValues only: the number each reel must print, indexed by reel.")]
    public string[] values = new string[SlotMachineResult.ReelCount];

    [Tooltip("ExactSymbols only: the symbol each reel must show, indexed by reel.")]
    public SlotSymbolId[] symbols = new SlotSymbolId[SlotMachineResult.ReelCount];

    [Tooltip("What the win is multiplied by, unless Multiplier From Items is on.")]
    public float multiplier = 1f;

    [Tooltip("Flat part of the award. The result reports base reward and base reward x multiplier.")]
    public int baseReward = 100;

    [Tooltip("Take the multiplier from the matched positions instead of the field above, using the " +
             "smallest of the three. This is how a triple of 10s pays ten times and a triple of 3s three.")]
    public bool multiplierFromItems;

    [Tooltip("Highest priority wins when more than one line matches. Ties keep list order.")]
    public int priority;
}

/// <summary>
/// The editable paytable. Nothing here knows about money: a line reports an id, a multiplier and a
/// base reward, and whatever drives the show decides what those are worth.
///
/// Evaluation looks only at the three items on the win line. Adding a line never needs a code
/// change unless it needs a new <see cref="SlotMatchKind"/>.
/// </summary>
[CreateAssetMenu(menuName = "GameShow/Slot Machine/Paytable", fileName = "GoldenLuck_Paytable")]
public class SlotPaytable : ScriptableObject
{
    [Tooltip("Every winning line. Order only breaks priority ties.")]
    [SerializeField] private List<SlotWinCombination> combinations = new List<SlotWinCombination>();

    public IReadOnlyList<SlotWinCombination> Combinations
    {
        get { return combinations; }
    }

    /// <summary>
    /// The best line the three win-line items match, or <see cref="SlotPaytableMatch.NoWin"/>.
    /// <paramref name="line"/> must hold one item per reel; a null entry can never match.
    /// </summary>
    public SlotPaytableMatch Evaluate(IReadOnlyList<SlotReelItem> line)
    {
        if (line == null || line.Count < SlotMachineResult.ReelCount)
        {
            return SlotPaytableMatch.NoWin;
        }

        for (int i = 0; i < SlotMachineResult.ReelCount; i++)
        {
            if (line[i] == null)
            {
                return SlotPaytableMatch.NoWin;
            }
        }

        SlotWinCombination best = null;
        for (int i = 0; i < combinations.Count; i++)
        {
            var candidate = combinations[i];
            if (candidate == null || !Matches(candidate, line))
            {
                continue;
            }

            if (best == null || candidate.priority > best.priority)
            {
                best = candidate;
            }
        }

        if (best == null)
        {
            return SlotPaytableMatch.NoWin;
        }

        float multiplier = best.multiplier;
        if (best.multiplierFromItems)
        {
            multiplier = line[0].multiplier;
            for (int i = 1; i < SlotMachineResult.ReelCount; i++)
            {
                multiplier = Mathf.Min(multiplier, line[i].multiplier);
            }
        }

        return new SlotPaytableMatch
        {
            IsWin = true,
            CombinationId = best.id,
            Multiplier = multiplier,
            BaseReward = best.baseReward,
            MatchedReels = AllReels(),
        };
    }

    private static bool Matches(SlotWinCombination combination, IReadOnlyList<SlotReelItem> line)
    {
        switch (combination.kind)
        {
            case SlotMatchKind.SymbolTriple:
                for (int i = 0; i < SlotMachineResult.ReelCount; i++)
                {
                    if (!line[i].IsSymbol(combination.symbol))
                    {
                        return false;
                    }
                }

                return true;

            case SlotMatchKind.AnySymbolTriple:
                if (line[0].kind != SlotReelItemKind.Symbol)
                {
                    return false;
                }

                for (int i = 1; i < SlotMachineResult.ReelCount; i++)
                {
                    if (!line[i].IsSymbol(line[0].symbol))
                    {
                        return false;
                    }
                }

                return true;

            case SlotMatchKind.ValueTriple:
                if (line[0].kind != SlotReelItemKind.Value)
                {
                    return false;
                }

                for (int i = 1; i < SlotMachineResult.ReelCount; i++)
                {
                    if (line[i].kind != SlotReelItemKind.Value ||
                        !string.Equals(line[i].displayText, line[0].displayText, StringComparison.OrdinalIgnoreCase))
                    {
                        return false;
                    }
                }

                return true;

            case SlotMatchKind.ExactValues:
                if (combination.values == null || combination.values.Length < SlotMachineResult.ReelCount)
                {
                    return false;
                }

                for (int i = 0; i < SlotMachineResult.ReelCount; i++)
                {
                    if (line[i].kind != SlotReelItemKind.Value ||
                        !string.Equals(line[i].displayText, combination.values[i], StringComparison.OrdinalIgnoreCase))
                    {
                        return false;
                    }
                }

                return true;

            case SlotMatchKind.ExactSymbols:
                if (combination.symbols == null || combination.symbols.Length < SlotMachineResult.ReelCount)
                {
                    return false;
                }

                for (int i = 0; i < SlotMachineResult.ReelCount; i++)
                {
                    if (!line[i].IsSymbol(combination.symbols[i]))
                    {
                        return false;
                    }
                }

                return true;

            default:
                return false;
        }
    }

    private static int[] AllReels()
    {
        var reels = new int[SlotMachineResult.ReelCount];
        for (int i = 0; i < reels.Length; i++)
        {
            reels[i] = i;
        }

        return reels;
    }
}
