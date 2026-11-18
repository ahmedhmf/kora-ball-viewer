import { Routes } from '@angular/router';
import { ViewerComponent } from './components/viewer/viewer.component';
import { TechpackPreparerComponent } from './components/techpack-preparer/techpack-preparer.component';

export const routes: Routes = [
  { path: '', component: ViewerComponent },
  { path: 'prepare-design', component: TechpackPreparerComponent },
  { path: 'techpack', component: TechpackPreparerComponent },
  { path: '**', redirectTo: '' },
];
