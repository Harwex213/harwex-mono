using Shared.Scripts.WsConnection.Dto;
using UnityEngine;

namespace Shared.Scripts
{
    public class GameState : MonoBehaviour
    {
        private readonly WsStateManager _wsStateManager;

        public GameState(WsStateManager wsStateManager)
        {
            _wsStateManager = wsStateManager;
        }

        public void Update()
        {
            WsConnectionMessage message;

            var hasNewMessage = _wsStateManager.MessageQueue.TryDequeue(out message);
            if (hasNewMessage)
            {
                // TODO: process message
            }
        }
    }
}