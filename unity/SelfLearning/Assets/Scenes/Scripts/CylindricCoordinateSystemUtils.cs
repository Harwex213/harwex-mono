using UnityEngine;

namespace Scenes.Scripts
{
    public static class CylindricCoordinateSystemUtils
    {
        public static Vector3 CylindricToCartesian(float radius, float angle, float height)
        {
            return new Vector3(radius * Mathf.Sin(angle), height, radius * Mathf.Cos(angle));
        } 
    }
}