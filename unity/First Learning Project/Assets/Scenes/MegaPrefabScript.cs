using UnityEngine;

public class MegaPrefabScript : MonoBehaviour
{
    // Update is called once per frame
    void Update()
    {
        transform.rotation *= Quaternion.Euler(100f * Time.deltaTime, 0, 0);
    }
}
