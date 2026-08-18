using Scenes.Scripts;
using UnityEngine;

public class CylindricCoordinateSystem : MonoBehaviour
{
    public float animationTimeSec = 3f;

    public float startHeight = 0f;
    public float endHeight = 3f;

    public float startRadius = 0f;
    public float endRadius = 3f;

    public float startAngle = 0f;
    public float endAngle = 360f;

    private void Update()
    {
        var speed = animationTimeSec == 0 ? 0 : Mathf.PI / 2f / this.animationTimeSec;
        var sineValue = Mathf.Abs(Mathf.Sin(Time.time * speed));

        var height = this.startHeight + (this.endHeight - this.startHeight) * sineValue;
        var radius = this.startRadius + (this.endRadius - this.startRadius) * sineValue;
        var angle = this.startAngle + (this.endAngle - this.startAngle) * sineValue * Mathf.PI / 180f;

        var position = CylindricCoordinateSystemUtils.CylindricToCartesian(radius, angle, height);
        this.transform.localPosition = position;
    }
}
