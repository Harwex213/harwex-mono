/// <summary>The three symbols the Golden Luck reels carry.</summary>
public enum SlotSymbolId
{
    Star,
    Bell,
    Horseshoe,
}

/// <summary>
/// Where the machine is in a spin. The order is the order a spin walks through, except that
/// <see cref="Win"/> and <see cref="Lose"/> are alternatives and <see cref="Disabled"/> is only
/// reached by disabling the component.
/// </summary>
public enum SlotMachineState
{
    Disabled,
    Idle,
    Starting,
    Spinning,
    Stopping,
    Evaluating,
    Win,
    Lose,
    Cooldown,
}

/// <summary>What a finished spin was worth.</summary>
public enum SlotOutcome
{
    /// <summary>The spin has not been evaluated yet.</summary>
    Pending,
    Lose,
    Win,
}

/// <summary>Whether a reel position shows a number or one of the three symbols.</summary>
public enum SlotReelItemKind
{
    Value,
    Symbol,
}

/// <summary>Where the result of the next spin comes from.</summary>
public enum SlotResultMode
{
    /// <summary>Drawn from the reel weights.</summary>
    Random,

    /// <summary>Taken from <c>ForcedResult</c>, for tests and for a show the studio drives.</summary>
    Forced,
}

/// <summary>How a paytable line decides whether the three win-line items match it.</summary>
public enum SlotMatchKind
{
    /// <summary>All three reels show <c>Symbol</c>.</summary>
    SymbolTriple,

    /// <summary>All three reels show the same symbol, whichever it is.</summary>
    AnySymbolTriple,

    /// <summary>All three reels show a number and all three numbers read the same.</summary>
    ValueTriple,

    /// <summary>Reel i shows the number in <c>Values[i]</c>.</summary>
    ExactValues,

    /// <summary>Reel i shows the symbol in <c>Symbols[i]</c>. This is the mixed combination.</summary>
    ExactSymbols,
}
