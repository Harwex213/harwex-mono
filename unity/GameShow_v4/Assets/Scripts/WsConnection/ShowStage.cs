using System;

/// <summary>The main round and the four bonus rounds.</summary>
public enum ShowGame
{
    Unknown,
    Main,
    BonusLuck,
    BonusDice,
    BonusDeluxe,
    BonusShow,
}

/// <summary>
/// The phase inside a round. The studio waits on <see cref="Spinning"/>, <see cref="Result"/>,
/// <see cref="Switch"/> and <see cref="Canceling"/>. Its own timer advances the other two.
/// </summary>
public enum ShowPhase
{
    Unknown,
    Start,
    Waiting,
    Spinning,
    Result,
    Switch,
    Canceling,
}

/// <summary>
/// A stage uri from the studio, such as <c>MAIN_SPINNING</c> or <c>BONUS_LUCK_SWITCH</c>, split
/// into the round it belongs to and the phase inside that round.
/// </summary>
public readonly struct ShowStage
{
    public readonly string Uri;
    public readonly ShowGame Game;
    public readonly ShowPhase Phase;

    private ShowStage(string uri, ShowGame game, ShowPhase phase)
    {
        Uri = uri;
        Game = game;
        Phase = phase;
    }

    /// <summary>True when the studio waits for a done before it advances the round.</summary>
    public bool IsGated
    {
        get
        {
            return Phase == ShowPhase.Spinning
                || Phase == ShowPhase.Result
                || Phase == ShowPhase.Switch
                || Phase == ShowPhase.Canceling;
        }
    }

    /// <summary>True when both the round and the phase were recognised.</summary>
    public bool IsKnown
    {
        get { return Game != ShowGame.Unknown && Phase != ShowPhase.Unknown; }
    }

    /// <summary>Splits a uri at its last underscore into a round prefix and a phase name.</summary>
    public static ShowStage Parse(string uri)
    {
        if (string.IsNullOrEmpty(uri))
        {
            return new ShowStage(uri, ShowGame.Unknown, ShowPhase.Unknown);
        }

        int split = uri.LastIndexOf('_');
        if (split < 0)
        {
            return new ShowStage(uri, ShowGame.Unknown, ShowPhase.Unknown);
        }

        string gameName = uri.Substring(0, split);
        string phaseName = uri.Substring(split + 1);

        return new ShowStage(uri, ParseGame(gameName), ParsePhase(phaseName));
    }

    private static ShowGame ParseGame(string name)
    {
        switch (name)
        {
            case "MAIN": return ShowGame.Main;
            case "BONUS_LUCK": return ShowGame.BonusLuck;
            case "BONUS_DICE": return ShowGame.BonusDice;
            case "BONUS_DELUXE": return ShowGame.BonusDeluxe;
            case "BONUS_SHOW": return ShowGame.BonusShow;
            default: return ShowGame.Unknown;
        }
    }

    private static ShowPhase ParsePhase(string name)
    {
        switch (name)
        {
            case "START": return ShowPhase.Start;
            case "WAITING": return ShowPhase.Waiting;
            case "SPINNING": return ShowPhase.Spinning;
            case "RESULT": return ShowPhase.Result;
            case "SWITCH": return ShowPhase.Switch;
            case "CANCELING": return ShowPhase.Canceling;
            default: return ShowPhase.Unknown;
        }
    }

    public override string ToString()
    {
        return string.IsNullOrEmpty(Uri) ? "<none>" : Uri;
    }
}
