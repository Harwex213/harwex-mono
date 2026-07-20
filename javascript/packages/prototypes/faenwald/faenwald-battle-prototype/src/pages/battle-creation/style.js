const STYLE = `
  <style>
    .bc {
      font-family: var(--font-body);
      color: var(--text-primary);
      padding: var(--space-8);
    }

    .bc .box-label {
      display: inline-block;
      margin: 0 0 var(--space-7);
      padding: var(--space-5) var(--space-8);
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      color: var(--text-accent);
    }

    .bc .maps {
      display: flex;
      gap: var(--space-8);
      margin-bottom: var(--space-8);
    }

    .bc .map-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      cursor: pointer;
    }

    .bc .map-card img, .bc .map-card .map-thumb {
      width: 96px;
      height: 88px;
      object-fit: cover;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
    }

    .bc .map-card .map-thumb {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--card-bg);
      font-size: var(--font-size-xl);
      color: var(--text-faint);
    }

    .bc .map-card:hover img, .bc .map-card:hover .map-thumb {
      border-color: var(--border-accent-muted);
    }

    .bc hr {
      border: none;
      border-top: 1px solid var(--border-default);
      margin: 0 0 var(--space-8);
    }

    .bc .sides {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-8);
    }

    .bc .side {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-7);
      padding: 0 var(--space-8) var(--space-8) 0;
    }

    .bc .side--defender {
      align-items: flex-end;
      padding: 0 0 var(--space-8) var(--space-8);
      border-left: 1px solid var(--border-default);
    }

    .bc .side-label {
      padding: var(--space-4) var(--space-7);
      font-family: var(--font-display);
      font-size: var(--font-size-lg);
      color: var(--text-secondary);
    }

    .bc .unit {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--card-padding);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
    }

    .bc .side--defender .unit {
      align-items: flex-end;
    }

    .bc .unit-row {
      display: flex;
      align-items: center;
      gap: var(--space-6);
    }

    .bc select, .bc button, .bc input {
      font: inherit;
      color: var(--text-primary);
      background: var(--bg-control);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      padding: var(--space-4) var(--space-6);
    }

    .bc select:hover, .bc input:focus {
      border-color: var(--border-accent-muted);
      outline: none;
    }

    .bc button {
      cursor: pointer;
    }

    .bc button:hover {
      background: var(--bg-control-hover);
    }

    .bc button:disabled {
      color: var(--text-muted);
      border-color: var(--border-default);
      background: transparent;
      cursor: default;
    }

    .bc .stats {
      padding: var(--space-4) var(--space-6);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      white-space: nowrap;
    }

    .bc .modifier-row {
      display: flex;
      align-items: center;
      gap: var(--space-6);
      margin-left: var(--space-8);
    }

    .bc .side--defender .modifier-row {
      margin-left: 0;
      margin-right: var(--space-8);
    }

    .bc .modifier-name {
      min-width: 220px;
      padding: var(--space-4) var(--space-6);
      background: var(--bg-control-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      text-align: center;
    }

    .bc .combo {
      position: relative;
      margin-left: var(--space-8);
    }

    .bc .side--defender .combo {
      margin-left: 0;
      margin-right: var(--space-8);
    }

    .bc .combo ul {
      position: absolute;
      z-index: 1;
      left: 0;
      right: 0;
      margin: 0;
      padding: 0;
      list-style: none;
      background: var(--bg-surface-raised);
      border: 1px solid var(--border-medium);
      border-top: none;
      border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    }

    .bc .combo li button {
      display: block;
      width: 100%;
      border: none;
      border-radius: 0;
      background: transparent;
      text-align: left;
    }

    .bc .combo li button:hover {
      background: var(--bg-control-hover);
    }

    .bc .start {
      display: flex;
      align-items: center;
      gap: var(--space-7);
      margin-top: var(--space-4);
    }

    .bc .hint {
      margin: 0;
      color: var(--text-muted);
    }
  </style>
`;

export { STYLE };
