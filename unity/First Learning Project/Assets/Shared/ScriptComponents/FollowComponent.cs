using UnityEngine;

namespace Shared.ScriptComponents
{
    public class FollowComponent : MonoBehaviour
    {
        public Transform target;
        public TestScriptableObjectScript SharedData;

        void Update()
        {
            var delta = target.position - transform.position;
            transform.position += delta * (SharedData.Amount * Time.deltaTime);
        }
    }
}