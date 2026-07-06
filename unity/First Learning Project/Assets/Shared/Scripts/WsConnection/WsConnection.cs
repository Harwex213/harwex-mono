using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Shared.Scripts.WsConnection.Dto;
using TMPro;
using UnityEngine;

namespace Shared.Scripts.WsConnection
{
    public class WsConnection : MonoBehaviour
    {
        [SerializeField] private TMP_Text _textMesh;
        [SerializeField] private TestScriptableObjectScript _sharedData;

        private readonly string[] GATED_STAGES =
        {
            "SPINNING",
            "RESULT",
            "SWITCH",
            "CANCELING"
        };

        private WsConnectionMessage _lastMessage = new();
        private WsConnectionResponse _lastResponse;

        private ClientWebSocket _ws;

        // TODO: чё за Awaitable...
        private async Awaitable Start()
        {
            _ws = new ClientWebSocket();

            try
            {
                await _ws.ConnectAsync(new Uri("ws://localhost:9435/joker-show/ws"), destroyCancellationToken);

                ArraySegment<byte> readBuffer = new(new byte[4096]);
                using var readStream = new MemoryStream();

                _ = Task.Run(ProcessMessageQueue);

                while (_ws.State == WebSocketState.Open)
                {
                    readStream.SetLength(0);
                    
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await _ws.ReceiveAsync(readBuffer, destroyCancellationToken);
                        await readStream.WriteAsync(readBuffer.Array, 0, result.Count);
                    } while (!result.EndOfMessage);

                    var messageString = Encoding.UTF8.GetString(readStream.ToArray());
                    
                    Debug.Log(messageString);

                    var message = JsonConvert.DeserializeObject<WsConnectionMessage>(messageString);

                    // TODO: чё за MainThreadAsync...
                    await Awaitable.MainThreadAsync();

                    _textMesh.text = message.Uri;

                    if (_lastMessage.Uri == message.Uri && _lastMessage.CorrelationId == message.CorrelationId)
                        continue;

                    var isGatedStage = Array.Exists(GATED_STAGES, v => message.Uri.Contains(v));
                    if (isGatedStage)
                    {
                        _lastResponse = new WsConnectionResponse
                        {
                            Uri = message.Uri,
                            CorrelationId = message.CorrelationId
                        };

                        if (message.Uri.Contains("SPINNING"))
                        {
                            _sharedData.GameState = ScriptComponents.GameState.PLAYING;
                        }
                        else
                        {
                            _sharedData.MessageQueue.Enqueue("message");
                        }
                    }
                    if (message.Uri.Contains("START") || message.Uri.Contains("WAITING"))
                    {
                        _sharedData.GameState =  ScriptComponents.GameState.IDLE;
                    }
                    
                    // TODO: transition
                    _lastMessage = message;
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"Connection failed: {e.Message}");
            }
        }

        private async Task ProcessMessageQueue()
        {
            while (_ws.State == WebSocketState.Open)
            {
                await _sharedData.MessageQueue.DequeueAsync(destroyCancellationToken);
                
                var responseString = JsonConvert.SerializeObject(_lastResponse);

                await _ws.SendAsync(
                    Encoding.UTF8.GetBytes(responseString),
                    WebSocketMessageType.Text,
                    endOfMessage: true,
                    destroyCancellationToken
                );
            }
        }

        private void OnDestroy()
        {
            _ws?.Dispose();
        }
    }
}