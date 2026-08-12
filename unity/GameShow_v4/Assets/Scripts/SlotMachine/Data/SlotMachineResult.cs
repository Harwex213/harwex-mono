using System;
using System.Text;

/// <summary>
/// Which position each reel stops on, and what the paytable made of that.
///
/// The two halves are filled at different times. The three positions are decided before the reels
/// slow down — either drawn from the weights or handed in by a show — and everything else is
/// filled by <see cref="SlotPaytable"/> once the reels have stopped. A result handed to
/// <c>SpinWithResult</c> therefore only has to carry the positions.
/// </summary>
[Serializable]
public class SlotMachineResult
{
    public const int ReelCount = 3;

    private static readonly int[] NoReels = new int[0];

    private readonly int[] _itemIndices = new int[ReelCount];
    private int[] _matchedReels = NoReels;

    private SlotMachineResult(int left, int center, int right)
    {
        _itemIndices[0] = left;
        _itemIndices[1] = center;
        _itemIndices[2] = right;
        Outcome = SlotOutcome.Pending;
        CombinationId = string.Empty;
        Multiplier = 0f;
    }

    /// <summary>The three positions, indexed by reel: 0 left, 1 center, 2 right.</summary>
    public static SlotMachineResult FromIndices(int left, int center, int right)
    {
        return new SlotMachineResult(left, center, right);
    }

    /// <summary>Strip position reel <paramref name="reel"/> stops on.</summary>
    public int ItemIndex(int reel)
    {
        return _itemIndices[reel];
    }

    /// <summary>Id of the paytable line that matched, or empty when nothing did.</summary>
    public string CombinationId { get; private set; }

    public float Multiplier { get; private set; }

    /// <summary>Flat part of the award, before the multiplier.</summary>
    public int BaseReward { get; private set; }

    /// <summary>What the spin is worth: the base reward scaled by the multiplier, rounded.</summary>
    public int Reward { get; private set; }

    public SlotOutcome Outcome { get; private set; }

    public bool IsWin
    {
        get { return Outcome == SlotOutcome.Win; }
    }

    /// <summary>
    /// Reels that took part in the matched line, so the view knows which ones to light up. Empty on
    /// a loss. Every line in the shipped paytable matches all three, but a two-of-a-kind line added
    /// later would report only its own reels.
    /// </summary>
    public int[] MatchedReels
    {
        get { return _matchedReels; }
    }

    public bool IsReelMatched(int reel)
    {
        for (int i = 0; i < _matchedReels.Length; i++)
        {
            if (_matchedReels[i] == reel)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Writes the paytable's verdict onto this result. Called once, after the reels stop.</summary>
    public void ApplyEvaluation(SlotPaytableMatch match)
    {
        Outcome = match.IsWin ? SlotOutcome.Win : SlotOutcome.Lose;
        CombinationId = match.CombinationId ?? string.Empty;
        Multiplier = match.Multiplier;
        BaseReward = match.BaseReward;
        Reward = match.IsWin ? UnityEngine.Mathf.RoundToInt(match.BaseReward * match.Multiplier) : 0;
        _matchedReels = match.MatchedReels ?? NoReels;
    }

    /// <summary>Puts the result back to "positions chosen, nothing evaluated".</summary>
    public void ClearEvaluation()
    {
        Outcome = SlotOutcome.Pending;
        CombinationId = string.Empty;
        Multiplier = 0f;
        BaseReward = 0;
        Reward = 0;
        _matchedReels = NoReels;
    }

    /// <summary>A copy, so a caller cannot keep editing a result the machine is already playing.</summary>
    public SlotMachineResult Clone()
    {
        var copy = new SlotMachineResult(_itemIndices[0], _itemIndices[1], _itemIndices[2]);
        copy.Outcome = Outcome;
        copy.CombinationId = CombinationId;
        copy.Multiplier = Multiplier;
        copy.BaseReward = BaseReward;
        copy.Reward = Reward;
        copy._matchedReels = _matchedReels;
        return copy;
    }

    public override string ToString()
    {
        var sb = new StringBuilder();
        sb.Append("items[").Append(_itemIndices[0]).Append(',').Append(_itemIndices[1]).Append(',').Append(_itemIndices[2]).Append(']');
        sb.Append(' ').Append(Outcome);
        if (Outcome == SlotOutcome.Win)
        {
            sb.Append(" '").Append(CombinationId).Append("' x").Append(Multiplier).Append(" = ").Append(Reward);
        }

        return sb.ToString();
    }
}

/// <summary>What <see cref="SlotPaytable.Evaluate"/> found. A value type, so a loss costs nothing.</summary>
public struct SlotPaytableMatch
{
    public bool IsWin;
    public string CombinationId;
    public float Multiplier;
    public int BaseReward;
    public int[] MatchedReels;

    public static SlotPaytableMatch NoWin
    {
        get { return new SlotPaytableMatch { IsWin = false, CombinationId = string.Empty, MatchedReels = null }; }
    }
}
