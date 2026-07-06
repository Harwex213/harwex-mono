using UnityEngine;

namespace Shared.ScriptComponents
{
    public class FollowComponent : MonoBehaviour
    {
        public Transform target;
        public TestScriptableObjectScript SharedData;

        private Vector3 _startPosition;

        public void Start()
        {
            _startPosition = transform.position;
        }

        private void OnEnable()
        {
            SharedData.StateChanged += OnStateChanged;
        }

        private void OnDisable()
        {
            SharedData.StateChanged -= OnStateChanged;
        }

        private void OnStateChanged(GameState state)
        {
            if (state == GameState.IDLE) ResetPosition();
        }

        public void Update()
        {
            if (SharedData.GameState == GameState.PLAYING) UpdatePlaying();
        }

        private void UpdatePlaying()
        {
            var delta = target.position - transform.position;
            transform.position += delta * (SharedData.Speed * Time.deltaTime);

            if (delta.magnitude <= 1f) SharedData.GameState = GameState.FINISHED;
        }

        private void ResetPosition()
        {
            transform.position = _startPosition;
        }
    }
}