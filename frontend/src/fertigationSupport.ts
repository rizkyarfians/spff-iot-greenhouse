import type {GuideActivity,GuideProgram} from '@spff/contracts'
/** Current hardware can automate only kocor. Other guide activities remain manual tasks. */
export const supportsFertigationAutomation=(activity:Pick<GuideActivity,'method'>)=>activity.method.trim().toLowerCase()==='kocor'
export const automaticGuideActivities=(program:Pick<GuideProgram,'plan'>)=>program.plan.activities.filter(supportsFertigationAutomation)
