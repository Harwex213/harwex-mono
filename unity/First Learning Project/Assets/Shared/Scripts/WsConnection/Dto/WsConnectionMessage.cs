using Newtonsoft.Json;

namespace Shared.Scripts.WsConnection.Dto
{
    public class WsConnectionMessage
    {
        [JsonProperty("uri", Required = Required.Always)]
        public string Uri { get; set; }

        [JsonProperty("correlationId", Required = Required.Always)]
        public string CorrelationId { get; set; }

        [JsonProperty("payload", Required = Required.Default)]
        public WsConnectionMessagePayload Payload { get; set; }
    }

    public class WsConnectionMessagePayload
    {
        [JsonProperty("result", Required = Required.Default)]
        public string Result { get; set; }

        [JsonProperty("bonusSpin", Required = Required.Default)]
        public int BonusSpin { get; set; }
    }

    public class WsConnectionResponse
    {
        [JsonProperty("uri", Required = Required.Always)]
        public string Uri { get; set; }

        [JsonProperty("correlationId", Required = Required.Always)]
        public string CorrelationId { get; set; }
    }
}