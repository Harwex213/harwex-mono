using Scenes.Scripts;
using UnityEngine;

public class CylindricCoordinateSystem : MonoBehaviour
{
    private readonly float _moveSpeed = 10f;
    public float height;
    public float radius;
    public float angle;

    void Start()
    {
        var position = CylindricCoordinateSystemUtils.CylindricToCartesian(radius, angle, height);
        this.transform.localPosition = position;
    }
}
