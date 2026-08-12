using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// The machine's sound. Four sources, because they overlap: the spin loop has to keep running under
/// a reel's landing click, and a win sting has to land over both.
///
/// Every clip is optional. With none set the machine plays in silence and says so once, in the
/// editor only — it never substitutes a tone for a missing clip, because a placeholder beep in a
/// television studio is worse than nothing.
/// </summary>
[DisallowMultipleComponent]
public class SlotMachineAudio : MonoBehaviour
{
    [Header("Sources")]
    [Tooltip("Loops while the reels turn. Its pitch bends down as they slow.")]
    [SerializeField] private AudioSource spinSource;

    [Tooltip("One click per reel as it lands.")]
    [SerializeField] private AudioSource stopSource;

    [Tooltip("The win sting.")]
    [SerializeField] private AudioSource winSource;

    [Tooltip("Interface sounds: the press that starts a spin, and the neutral end of a loss.")]
    [SerializeField] private AudioSource uiSource;

    [Header("Reel clicks")]
    [Tooltip("Pitch of the click for reel 0, 1 and 2, so the three landings do not sound identical.")]
    [SerializeField] private float[] reelStopPitches = { 0.96f, 1f, 1.05f };

    private SlotMachineConfig _config;
    private float _spinBasePitch = 1f;
    private bool _warned;

    /// <summary>Attaches the clips from the config and stops anything still playing.</summary>
    public void Bind(SlotMachineConfig config)
    {
        _config = config;

        if (spinSource != null)
        {
            spinSource.clip = config == null ? null : config.SpinLoopClip;
            spinSource.loop = true;
            spinSource.playOnAwake = false;
            _spinBasePitch = spinSource.pitch;
        }

        if (stopSource != null)
        {
            stopSource.playOnAwake = false;
            stopSource.loop = false;
        }

        if (winSource != null)
        {
            winSource.playOnAwake = false;
            winSource.loop = false;
        }

        if (uiSource != null)
        {
            uiSource.playOnAwake = false;
            uiSource.loop = false;
        }

        StopAll();
        WarnAboutMissingClipsOnce();
    }

    /// <summary>The press that starts a spin.</summary>
    public void PlaySpinStart()
    {
        PlayOneShot(uiSource, _config == null ? null : _config.SpinStartClip);
    }

    /// <summary>Starts the loop under the reels. Doing it twice does not stack a second copy.</summary>
    public void StartSpinLoop()
    {
        if (spinSource == null || spinSource.clip == null)
        {
            return;
        }

        spinSource.pitch = _spinBasePitch;
        if (!spinSource.isPlaying)
        {
            spinSource.Play();
        }
    }

    /// <summary>
    /// Bends the loop's pitch down as the reels slow. <paramref name="slowdown"/> is 0 at full speed
    /// and 1 when everything has stopped.
    /// </summary>
    public void SetSpinSlowdown(float slowdown)
    {
        if (spinSource == null || _config == null)
        {
            return;
        }

        spinSource.pitch = Mathf.Lerp(_spinBasePitch, _spinBasePitch * _config.SpinPitchAtStop, Mathf.Clamp01(slowdown));
    }

    public void StopSpinLoop()
    {
        if (spinSource == null)
        {
            return;
        }

        spinSource.Stop();
        spinSource.pitch = _spinBasePitch;
    }

    /// <summary>The click of one reel landing.</summary>
    public void PlayReelStop(int reel)
    {
        var clip = _config == null ? null : _config.ReelStopClip;
        if (stopSource == null || clip == null)
        {
            return;
        }

        stopSource.pitch = reelStopPitches != null && reel >= 0 && reel < reelStopPitches.Length
            ? reelStopPitches[reel]
            : 1f;
        stopSource.PlayOneShot(clip);
    }

    public void PlayWin()
    {
        PlayOneShot(winSource, _config == null ? null : _config.WinClip);
    }

    public void PlayLose()
    {
        PlayOneShot(uiSource, _config == null ? null : _config.LoseClip);
    }

    /// <summary>Silences everything. Called on reset and on disable, so nothing outlives the machine.</summary>
    public void StopAll()
    {
        StopSpinLoop();

        if (stopSource != null)
        {
            stopSource.Stop();
        }

        if (winSource != null)
        {
            winSource.Stop();
        }

        if (uiSource != null)
        {
            uiSource.Stop();
        }
    }

    /// <summary>What the audio rig is missing, appended to <paramref name="problems"/>.</summary>
    public void CollectProblems(List<string> problems)
    {
        if (problems == null)
        {
            return;
        }

        if (spinSource == null)
        {
            problems.Add("Audio: no spin source.");
        }

        if (stopSource == null)
        {
            problems.Add("Audio: no reel stop source.");
        }

        if (winSource == null)
        {
            problems.Add("Audio: no win source.");
        }

        // Missing clips are reported as information, not as breakage: the machine is expected to
        // ship before the sound design does.
        if (_config != null && _config.SpinLoopClip == null && _config.ReelStopClip == null && _config.WinClip == null)
        {
            problems.Add("Audio: the config carries no clips yet, so the machine plays silently.");
        }
    }

    private static void PlayOneShot(AudioSource source, AudioClip clip)
    {
        if (source == null || clip == null)
        {
            return;
        }

        source.PlayOneShot(clip);
    }

    private void WarnAboutMissingClipsOnce()
    {
#if UNITY_EDITOR
        if (_warned || _config == null)
        {
            return;
        }

        _warned = true;
        if (_config.SpinLoopClip == null && _config.ReelStopClip == null && _config.WinClip == null)
        {
            Debug.Log("[SlotMachine] no audio clips on " + _config.name + " yet; the machine will run silently.", this);
        }
#endif
    }

    private void OnDisable()
    {
        StopAll();
    }
}
