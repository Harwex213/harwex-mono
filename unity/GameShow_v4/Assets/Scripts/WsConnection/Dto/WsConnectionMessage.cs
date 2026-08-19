using Newtonsoft.Json;

/// <summary>One state frame from the studio. It names the stage the graphic app has to render.</summary>
public class WsConnectionMessage
{
    [JsonProperty("uri", Required = Required.Always)]
    public string Uri { get; set; }

    [JsonProperty("correlationId", Required = Required.Always)]
    public string CorrelationId { get; set; }

    [JsonProperty("payload", Required = Required.Default)]
    public WsConnectionMessagePayload Payload { get; set; }
}

/// <summary>The extra data a stage carries. Both fields are absent on most stages.</summary>
public class WsConnectionMessagePayload
{
    /// <summary>The outcome the wheel has to stop on. The studio picks it, the wheel obeys it.</summary>
    [JsonProperty("result", Required = Required.Default)]
    public string Result { get; set; }

    /// <summary>Which spin of a bonus round this is, counted from 1.</summary>
    [JsonProperty("bonusSpin", Required = Required.Default)]
    public int BonusSpin { get; set; }
}

/// <summary>
/// The only message the graphic app sends. It reports the stage the app has finished, so the
/// studio can advance the round. Both fields are echoed back from the state that arrived.
/// </summary>
public class WsConnectionResponse
{
    [JsonProperty("uri", Required = Required.Always)]
    public string Uri { get; set; }

    [JsonProperty("correlationId", Required = Required.Always)]
    public string CorrelationId { get; set; }
}
