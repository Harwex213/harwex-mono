using Microsoft.VisualStudio.Threading;
using Shared.Scripts.WsConnection.Dto;

namespace Shared.Scripts
{
    /**
     * Abstraction Boundary between Websocket Connection and Unity State
     */
    public class WsStateManager
    {
        public readonly AsyncQueue<WsConnectionMessage> MessageQueue = new();
    }
}