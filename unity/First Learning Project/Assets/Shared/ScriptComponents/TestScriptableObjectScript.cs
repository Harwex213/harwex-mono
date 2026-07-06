using Microsoft.VisualStudio.Threading;
using Shared.ScriptComponents;
using Unity.VisualScripting;
using UnityEngine;

[CreateAssetMenu(fileName = "TestScriptableObjectScript", menuName = "Scriptable Objects/TestScriptableObjectScript")]
public class TestScriptableObjectScript : ScriptableObject
{
    public int Speed;

    [DoNotSerialize] public readonly AsyncQueue<string> MessageQueue = new();

    [System.NonSerialized] private GameState _gameState = GameState.IDLE;

    public event System.Action<GameState> StateChanged;

    public GameState GameState
    {
        get => _gameState;
        set
        {
            if (_gameState == value) return;
            _gameState = value;
            MessageQueue.Enqueue("message");
            StateChanged?.Invoke(value);
        }
    }
}