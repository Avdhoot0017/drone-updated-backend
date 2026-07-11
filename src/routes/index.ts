import { Router } from 'express';
import authRoutes from './auth.routes';
import dashboardRoutes from './dashboard.routes';
import syncRoutes from './sync.routes';
import caseRoutes from './case.routes';
import reportsRoutes from './reports.routes';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/sync', syncRoutes);
router.use('/cases', caseRoutes);
router.use('/reports', reportsRoutes);

export default router;
