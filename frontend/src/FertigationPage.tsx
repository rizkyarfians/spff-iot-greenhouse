import {lazy, Suspense} from 'react'
import type {ApiDevice} from '@spff/contracts'
import {BookOpen, FlaskConical, Sparkles} from 'lucide-react'
import {fertigationSections, pageTitles, type FertigationSection} from './pageConfig'
import './GuidePrograms.css'
import './FertigationWorkspace.css'

const GuidePrograms = lazy(() => import('./GuidePrograms').then(module => ({default: module.GuidePrograms})))
const HstApprovalPanel = lazy(() => import('./HstApprovalPanel').then(module => ({default: module.HstApprovalPanel})))
const GuidePage = lazy(() => import('./GuidePage').then(module => ({default: module.GuidePage})))

const sectionIcons = {
  fertigation: FlaskConical,
  'ai-automation': Sparkles,
  guide: BookOpen,
}

export function FertigationPage({devices, section, onNavigate}: {
  devices: ApiDevice[]
  section: FertigationSection
  onNavigate: (section: FertigationSection) => void
}) {
  return <section className="ft-program-shell" aria-label="Program Fertigasi">
    <div className="gp-main-tabs" role="group" aria-label="Bagian Program Fertigasi">
      {fertigationSections.map(key => {
        const Icon = sectionIcons[key]
        return <button key={key} type="button" aria-pressed={section === key} onClick={() => onNavigate(key)}>
          <Icon size={18} aria-hidden="true" />
          {key === 'fertigation' ? 'Program tanaman' : pageTitles[key]}
        </button>
      })}
    </div>
    <Suspense fallback={<p role="status">Memuat halaman…</p>}>
      {section === 'fertigation' && <GuidePrograms devices={devices} />}
      {section === 'ai-automation' && <HstApprovalPanel />}
      {section === 'guide' && <GuidePage />}
    </Suspense>
  </section>
}
