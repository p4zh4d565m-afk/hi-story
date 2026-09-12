/**
 * 策划 AI 长任务完成后的项目守卫。
 *
 * 读路径已有 generation 守卫，写路径没有：`PlanningWorkspace` 常驻挂载，
 * 生成函数在长 `await` 之后无条件 setState，切到另一项目后会污染 B 的界面，
 * 用户再点确认就会用「B 的 projectId + A 的 options」写库。
 *
 * 返回 true 才允许把生成结果 setState 到当前界面；false 时结果仍应
 * 后台 persist 到 startedProjectId，但不落到当前 UI。
 */
export function shouldApplyPlanningResult(
  startedProjectId: string,
  currentProjectId: string | null,
): boolean {
  return currentProjectId === startedProjectId;
}
