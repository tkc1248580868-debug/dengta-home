export default function DeviceActionReceipts({ actions }) {
  if (!Array.isArray(actions) || actions.length === 0) return null;

  return (
    <div className="device-action-receipts" aria-label="外部设备执行回执">
      <strong>设备操作回执</strong>
      {actions.map((action, index) => (
        <span
          className={action?.ok === false ? "failed" : "success"}
          key={`${action?.tool || "tool"}-${index}`}
        >
          {action?.ok === false ? "未完成" : "已执行"} ·{" "}
          {action?.connection || "外部设备"} · {action?.tool || "工具"}
        </span>
      ))}
      <small>这里显示服务器实际调用记录，不代表 AI 具有意识。</small>
    </div>
  );
}
