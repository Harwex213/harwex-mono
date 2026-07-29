// Additive light shaft for the stage moving heads and beam spots.
//
// HDRP's volumetric fog does not scatter in this project, so the visible beams
// are cone geometry instead. The cone brightens where the view ray travels the
// furthest through it (facing the camera) and fades out toward the silhouette,
// which is what gives it a soft volumetric edge rather than a hard shell.
Shader "GameShow/BeamAdditive"
{
    Properties
    {
        [HDR] _BeamColor ("Beam Color (linear)", Color) = (1, 1, 1, 1)
        _EdgeSoftness ("Edge Softness", Range(0.5, 8)) = 2.5
        _LengthFade ("Length Fade", Range(0.1, 8)) = 1.6
        _ApexFade ("Apex Fade", Range(0.001, 0.5)) = 0.04
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "HDRenderPipeline"
            "Queue" = "Transparent+20"
            "IgnoreProjector" = "True"
        }

        Pass
        {
            Name "BeamAdditive"
            Tags { "LightMode" = "SRPDefaultUnlit" }

            Blend One One
            ZWrite Off
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex Vert
            #pragma fragment Frag

            // Core Common.hlsl first: it defines the platform macros (GLOBAL_CBUFFER_START
            // and friends) that HDRP's generated variable headers rely on.
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Common.hlsl"
            #include "Packages/com.unity.render-pipelines.high-definition/Runtime/ShaderLibrary/ShaderVariables.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionRWS : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float2 uv         : TEXCOORD2;
            };

            CBUFFER_START(UnityPerMaterial)
                float4 _BeamColor;
                float _EdgeSoftness;
                float _LengthFade;
                float _ApexFade;
            CBUFFER_END

            Varyings Vert(Attributes input)
            {
                Varyings output;
                float3 positionRWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(positionRWS);
                output.positionRWS = positionRWS;
                output.normalWS = normalize(TransformObjectToWorldNormal(input.normalOS));
                output.uv = input.uv;
                return output;
            }

            float4 Frag(Varyings input) : SV_Target
            {
                float3 viewDir = normalize(GetWorldSpaceViewDir(input.positionRWS));

                // Stand-in for optical depth: longest through the middle of the
                // cone, zero where the surface turns edge-on to the camera.
                float facing = saturate(abs(dot(input.normalWS, viewDir)));
                float body = pow(facing, _EdgeSoftness);

                // uv.y runs 0 at the fixture to 1 at the far end of the throw.
                float alongThrow = pow(saturate(1.0 - input.uv.y), _LengthFade);
                float apex = smoothstep(0.0, _ApexFade, input.uv.y);

                // _BeamColor is a plain post-exposure linear value. The
                // SRPDefaultUnlit pass does not get HDRP's exposure texture bound,
                // so scaling by GetCurrentExposureMultiplier() here is not reliable.
                float3 color = _BeamColor.rgb * (body * alongThrow * apex * _BeamColor.a);
                return float4(color, 0.0);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
