using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// The flashes, sweeps and dust. Kept apart from <see cref="SlotMachineView"/> because these are
/// timed one-shots rather than a state the display holds: the view is told what to look like, and
/// this is told to play something.
///
/// Everything runs on coroutines owned by this component, so <see cref="StopAll"/> can cut a win
/// reaction off mid-flight and leave every layer back at rest. That is what makes
/// <c>ResetMachine</c> safe to call while the gold is still flying.
///
/// The light sweep moves by UV rather than by transform: its texture is imported with Repeat, so
/// advancing <c>uvRect.x</c> walks the streak across the reel bay and round again with no mask and
/// no second copy of the sprite.
/// </summary>
[DisallowMultipleComponent]
public class SlotMachineEffects : MonoBehaviour
{
    [Header("Lower display")]
    [Tooltip("Gold burst over the horseshoe. Additive, alpha 0 at rest.")]
    [SerializeField] private Image winFlash;

    [Tooltip("Sparkles that come and go after a win. Additive, alpha 0 at rest.")]
    [SerializeField] private Image[] sparkles = new Image[0];

    [Header("Reel bay")]
    [Tooltip("Streak that runs across the gold frames. A RawImage, so its UVs can scroll.")]
    [SerializeField] private RawImage lightSweep;

    [Tooltip("How many texture widths one sweep travels. 1 crosses once.")]
    [SerializeField, Min(0.1f)] private float lightSweepTravel = 1f;

    [Tooltip("Peak brightness of the sweep while idle.")]
    [SerializeField, Range(0f, 1f)] private float idleSweepBrightness = 0.5f;

    [Tooltip("Peak brightness of the sweep during a win. At 1 it washes the reels out instead of " +
             "reading as a streak crossing them, so this stays well under the full value.")]
    [SerializeField, Range(0f, 1f)] private float winSweepBrightness = 0.45f;

    [Header("Particles")]
    [Tooltip("Gold dust in front of the cabinet. Left empty, the dust is simply skipped.")]
    [SerializeField] private ParticleSystem goldDust;

    private SlotMachineConfig _config;
    private Coroutine _idleSweeps;
    private Coroutine _win;

    /// <summary>Reads the sprites and timings out of the config and puts every layer at rest.</summary>
    public void Bind(SlotMachineConfig config)
    {
        _config = config;

        if (config != null)
        {
            if (winFlash != null && config.WinFlashSprite != null)
            {
                winFlash.sprite = config.WinFlashSprite;
            }

            for (int i = 0; i < sparkles.Length; i++)
            {
                if (sparkles[i] == null)
                {
                    continue;
                }

                var sprite = i % 2 == 0 ? config.SparkleStarSprite : config.SparkleSoftSprite;
                if (sprite != null)
                {
                    sparkles[i].sprite = sprite;
                }
            }

            if (lightSweep != null && config.LightSweepSprite != null && lightSweep.texture == null)
            {
                lightSweep.texture = config.LightSweepSprite.texture;
            }
        }

        StopAll();
    }

    /// <summary>Starts or stops the occasional idle sweep and the background dust.</summary>
    public void SetIdle(bool idle)
    {
        if (_idleSweeps != null)
        {
            StopCoroutine(_idleSweeps);
            _idleSweeps = null;
        }

        SetDustRate(idle && _config != null ? _config.IdleDustRate : 0f);

        if (idle && _config != null && isActiveAndEnabled && Application.isPlaying)
        {
            _idleSweeps = StartCoroutine(IdleSweeps());
        }
        else
        {
            HideSweep();
        }
    }

    /// <summary>Plays the whole win reaction. Cut short by <see cref="StopAll"/>.</summary>
    public void PlayWin()
    {
        if (_win != null)
        {
            StopCoroutine(_win);
        }

        if (!isActiveAndEnabled || !Application.isPlaying)
        {
            return;
        }

        _win = StartCoroutine(WinReaction());
    }

    /// <summary>
    /// The reaction to a loss: nothing gold. The dust drops away for a beat and comes back, which
    /// reads as the machine settling rather than as a reward.
    /// </summary>
    public void PlayLose()
    {
        StopAll();
        SetDustRate(0f);
    }

    /// <summary>Cancels every effect and returns each layer to rest.</summary>
    public void StopAll()
    {
        if (_win != null)
        {
            StopCoroutine(_win);
            _win = null;
        }

        if (_idleSweeps != null)
        {
            StopCoroutine(_idleSweeps);
            _idleSweeps = null;
        }

        SetAlpha(winFlash, 0f);
        for (int i = 0; i < sparkles.Length; i++)
        {
            SetAlpha(sparkles[i], 0f);
        }

        HideSweep();

        if (goldDust != null)
        {
            goldDust.Clear();
        }
    }

    /// <summary>What the effects rig is missing, appended to <paramref name="problems"/>.</summary>
    public void CollectProblems(List<string> problems)
    {
        if (problems == null)
        {
            return;
        }

        if (winFlash == null)
        {
            problems.Add("Effects: no win flash image, so a win will not flash.");
        }

        if (lightSweep == null)
        {
            problems.Add("Effects: no light sweep, so the frames will not catch the light.");
        }
        else if (lightSweep.texture == null)
        {
            problems.Add("Effects: the light sweep has no texture.");
        }

        if (goldDust == null)
        {
            problems.Add("Effects: no gold dust particle system.");
        }
    }

    private IEnumerator IdleSweeps()
    {
        // A first wait, so the sweep does not fire the instant the machine goes idle.
        yield return new WaitForSeconds(_config.LightSweepIntervalSeconds * 0.5f);

        while (true)
        {
            yield return Sweep(_config.LightSweepSeconds, idleSweepBrightness);
            yield return new WaitForSeconds(_config.LightSweepIntervalSeconds);
        }
    }

    private IEnumerator WinReaction()
    {
        SetDustRate(0f);
        if (goldDust != null && _config.WinDustBurst > 0)
        {
            goldDust.Emit(_config.WinDustBurst);
        }

        // The flash rises fast and falls slowly, which is what makes it read as a burst.
        float flash = Mathf.Max(0.05f, _config.WinFlashSeconds);
        float t = 0f;
        while (t < flash)
        {
            t += Time.deltaTime;
            float u = Mathf.Clamp01(t / flash);
            SetAlpha(winFlash, u < 0.25f ? u / 0.25f : 1f - (u - 0.25f) / 0.75f);
            yield return null;
        }

        SetAlpha(winFlash, 0f);

        var sweeps = StartCoroutine(WinSweeps());
        yield return Sparkle(_config.WinSparkleSeconds);
        yield return sweeps;

        SetDustRate(_config.IdleDustRate);
        _win = null;
    }

    private IEnumerator WinSweeps()
    {
        for (int i = 0; i < _config.WinSweepCount; i++)
        {
            yield return Sweep(_config.LightSweepSeconds * 0.6f, winSweepBrightness);
        }
    }

    /// <summary>Walks the streak across the bay once, by UV.</summary>
    private IEnumerator Sweep(float duration, float peakAlpha)
    {
        if (lightSweep == null)
        {
            yield break;
        }

        lightSweep.enabled = true;
        float t = 0f;
        var rect = lightSweep.uvRect;
        while (t < duration)
        {
            t += Time.deltaTime;
            float u = Mathf.Clamp01(t / duration);
            rect.x = -1f + u * (1f + lightSweepTravel);
            lightSweep.uvRect = rect;
            // Fade in and out at the ends so the streak does not pop at the frame edge.
            SetAlpha(lightSweep, Mathf.Sin(u * Mathf.PI) * peakAlpha);
            yield return null;
        }

        HideSweep();
    }

    private IEnumerator Sparkle(float duration)
    {
        if (sparkles.Length == 0 || duration <= 0f)
        {
            yield break;
        }

        float t = 0f;
        while (t < duration)
        {
            t += Time.deltaTime;
            float u = t / duration;
            float envelope = Mathf.Clamp01(Mathf.Sin(u * Mathf.PI) * 1.4f);
            for (int i = 0; i < sparkles.Length; i++)
            {
                // Each sparkle twinkles on its own beat, so they never blink together.
                float phase = (u * (5f + i * 2.3f) + i * 0.37f) * Mathf.PI * 2f;
                float twinkle = Mathf.Max(0f, Mathf.Sin(phase));
                SetAlpha(sparkles[i], twinkle * envelope);
            }

            yield return null;
        }

        for (int i = 0; i < sparkles.Length; i++)
        {
            SetAlpha(sparkles[i], 0f);
        }
    }

    private void HideSweep()
    {
        if (lightSweep == null)
        {
            return;
        }

        SetAlpha(lightSweep, 0f);
        var rect = lightSweep.uvRect;
        rect.x = -1f;
        lightSweep.uvRect = rect;
    }

    private void SetDustRate(float perSecond)
    {
        if (goldDust == null)
        {
            return;
        }

        var emission = goldDust.emission;
        emission.rateOverTime = perSecond;

        if (perSecond > 0f && !goldDust.isPlaying)
        {
            goldDust.Play();
        }
    }

    private static void SetAlpha(Graphic graphic, float alpha)
    {
        if (graphic == null)
        {
            return;
        }

        var color = graphic.color;
        color.a = Mathf.Clamp(alpha, 0f, 4f);
        graphic.color = color;
    }

    private void OnDisable()
    {
        // A disabled machine must not leave a half-finished flash on screen.
        StopAll();
    }
}
