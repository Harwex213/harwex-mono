using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;

/// <summary>
/// Holds the websocket to the studio open and reports every state frame that arrives.
///
/// The studio drives the show. It sends one stage at a time, and the graphic app renders it.
/// Four stages are gated: the studio holds the round until the app reports that stage as done.
/// <see cref="ShowDirector"/> renders a stage and calls <see cref="SendDone"/> when it finishes.
///
/// The socket runs on background threads. Every <see cref="StageReceived"/> call is marshalled
/// back to the main thread first, so subscribers can touch the scene.
///
/// <see cref="ShowDirectorDebug"/> drives the same subscribers with no studio behind them. It sets
/// <see cref="Offline"/> and feeds frames through <see cref="InjectStage"/>.
/// </summary>
[DisallowMultipleComponent]
public class WsConnection : MonoBehaviour
{
    [Header("Server")]
    [SerializeField] private string serverUrl = "ws://localhost:9435/joker-show/ws";

    [Tooltip("Seconds to wait before dialling the studio again after the socket drops.")]
    [SerializeField, Min(0.5f)] private float reconnectDelaySeconds = 3f;

    [Header("Debug")]
    [Tooltip(
        "Never dial the studio, and keep every done inside the app. " +
        "ShowDirectorDebug turns this on so it can drive the show on its own.")]
    [SerializeField] private bool offline;

    [Header("Logging")]
    [Tooltip("Log every frame the studio sends, exactly as it arrived.")]
    [SerializeField] private bool logRawMessages = true;

    /// <summary>Raised on the main thread for each new state frame from the studio.</summary>
    public event Action<WsConnectionMessage> StageReceived;

    /// <summary>
    /// Raised on the main thread each time the app reports a stage as done, offline as well as
    /// online. <see cref="ShowDirectorDebug"/> waits on it to advance a mocked round.
    /// </summary>
    public event Action<WsConnectionResponse> DoneSent;

    /// <summary>True while the socket is open.</summary>
    public bool IsConnected
    {
        get { return _ws != null && _ws.State == WebSocketState.Open; }
    }

    /// <summary>
    /// Holds the socket shut. A live socket is dropped as this turns on, and the studio is dialled
    /// again within <see cref="reconnectDelaySeconds"/> of it turning off.
    /// </summary>
    public bool Offline
    {
        get { return offline; }
        set
        {
            if (offline == value)
            {
                return;
            }

            offline = value;
            Debug.Log(value ? "[WS] offline, the studio is not dialled" : "[WS] online again", this);

            if (value)
            {
                // A live studio would send stages over the mocked ones.
                _ws?.Abort();
            }
        }
    }

    private ClientWebSocket _ws;

    /// <summary>The last frame handed to subscribers. A repeat of it is dropped.</summary>
    private WsConnectionMessage _lastMessage = new();

    /// <summary>The last done reported. It is sent again on every reconnect.</summary>
    private WsConnectionResponse _lastResponse;

    /// <summary>One sender at a time, so two dones never interleave on the socket.</summary>
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    /// <summary>Cancelled when this object is destroyed. Read on the main thread, used off it.</summary>
    private CancellationToken _shutdown;

    private void Awake()
    {
        _shutdown = destroyCancellationToken;
    }

    private async Awaitable Start()
    {
        while (!_shutdown.IsCancellationRequested)
        {
            if (offline)
            {
                // ShowDirectorDebug drives the show. Wait here until it hands the studio back.
                if (!await WaitBeforeDialling())
                {
                    return;
                }

                continue;
            }

            await RunConnection();

            if (_shutdown.IsCancellationRequested)
            {
                return;
            }

            if (!offline)
            {
                Debug.Log($"[WS] reconnecting in {reconnectDelaySeconds:0.#}s", this);
            }

            if (!await WaitBeforeDialling())
            {
                return;
            }
        }
    }

    /// <summary>Waits out the reconnect delay. False means this object is going away.</summary>
    private async Awaitable<bool> WaitBeforeDialling()
    {
        try
        {
            await Awaitable.WaitForSecondsAsync(reconnectDelaySeconds, _shutdown);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    /// <summary>Connects once, then reads frames until the socket closes or fails.</summary>
    private async Awaitable RunConnection()
    {
        _ws = new ClientWebSocket();

        try
        {
            Debug.Log($"[WS] connecting to {serverUrl}", this);
            await _ws.ConnectAsync(new Uri(serverUrl), _shutdown);
            Debug.Log("[WS] connected", this);

            // A done can be lost when the socket drops. The studio ignores a repeat for a stage
            // it has already left, so sending the last one again costs nothing.
            if (_lastResponse != null)
            {
                await SendResponse(_lastResponse);
            }

            ArraySegment<byte> readBuffer = new(new byte[4096]);
            using var readStream = new MemoryStream();

            while (_ws.State == WebSocketState.Open)
            {
                readStream.SetLength(0);

                WebSocketReceiveResult result;
                do
                {
                    result = await _ws.ReceiveAsync(readBuffer, _shutdown);
                    await readStream.WriteAsync(readBuffer.Array, 0, result.Count, _shutdown);
                } while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    Debug.Log("[WS] the studio closed the socket", this);
                    break;
                }

                var messageString = Encoding.UTF8.GetString(readStream.ToArray());

                if (logRawMessages)
                {
                    Debug.Log($"[WS] recv {messageString}", this);
                }

                WsConnectionMessage message;
                try
                {
                    message = JsonConvert.DeserializeObject<WsConnectionMessage>(messageString);
                }
                catch (JsonException e)
                {
                    Debug.LogError($"[WS] cannot read frame: {e.Message}", this);
                    continue;
                }

                // Subscribers move the wheel, so hand the frame over on the main thread.
                await Awaitable.MainThreadAsync();

                Dispatch(message);
            }
        }
        catch (OperationCanceledException)
        {
            // The object is going away. Nothing to report.
        }
        catch (Exception e)
        {
            if (offline)
            {
                Debug.Log("[WS] socket dropped, the show runs offline now", this);
            }
            else
            {
                Debug.LogError($"[WS] connection failed: {e.Message}", this);
            }
        }
        finally
        {
            _ws?.Dispose();
            _ws = null;
        }
    }

    /// <summary>
    /// Hands a frame to the subscribers as though the studio had sent it. It runs the same path a
    /// received frame runs, so a repeat of the frame before it is dropped the same way.
    /// Call it on the main thread.
    /// </summary>
    public void InjectStage(WsConnectionMessage message)
    {
        if (message == null)
        {
            Debug.LogError("[WS] cannot inject an empty frame", this);
            return;
        }

        Debug.Log($"[WS] mock {message.Uri} correlationId={message.CorrelationId}", this);
        Dispatch(message);
    }

    /// <summary>Hands a frame to the subscribers, unless it repeats the frame before it.</summary>
    private void Dispatch(WsConnectionMessage message)
    {
        bool isRepeat = _lastMessage.Uri == message.Uri
            && _lastMessage.CorrelationId == message.CorrelationId;
        if (isRepeat)
        {
            Debug.Log($"[WS] repeat of {message.Uri}, dropped", this);
            return;
        }

        _lastMessage = message;

        var handler = StageReceived;
        if (handler != null)
        {
            handler(message);
        }
    }

    /// <summary>
    /// Reports a stage as finished. The studio then advances the round and sends the next stage.
    /// Both arguments have to be the ones that arrived with that stage.
    /// </summary>
    public void SendDone(string uri, string correlationId)
    {
        var response = new WsConnectionResponse
        {
            Uri = uri,
            CorrelationId = correlationId,
        };

        _lastResponse = response;

        var handler = DoneSent;
        if (handler != null)
        {
            handler(response);
        }

        if (offline)
        {
            Debug.Log($"[WS] offline, done for {uri} stays in the app", this);
            return;
        }

        _ = SendResponse(response);
    }

    private async Task SendResponse(WsConnectionResponse response)
    {
        var socket = _ws;
        if (socket == null || socket.State != WebSocketState.Open)
        {
            Debug.LogWarning($"[WS] socket is closed, done for {response.Uri} waits for the reconnect", this);
            return;
        }

        try
        {
            await _sendLock.WaitAsync(_shutdown);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        try
        {
            var responseString = JsonConvert.SerializeObject(response);

            await socket.SendAsync(
                Encoding.UTF8.GetBytes(responseString),
                WebSocketMessageType.Text,
                endOfMessage: true,
                _shutdown
            );

            Debug.Log($"[WS] sent done {responseString}", this);
        }
        catch (OperationCanceledException)
        {
            // The object is going away. Nothing to report.
        }
        catch (Exception e)
        {
            Debug.LogError($"[WS] send failed: {e.Message}", this);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private void OnDestroy()
    {
        // Abort first, so a pending read gives up at once instead of holding the socket.
        _ws?.Abort();
        _ws?.Dispose();
        _ws = null;
    }
}
