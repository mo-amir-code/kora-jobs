import { createJob } from '../../lib/job';
import { logger } from '../../lib/logger';
import { supabase } from '../../lib/supabase';

export const run = createJob(async () => {
    logger.info("reminders job started");
    logger.info(`Current job timestamp: ${new Date().toISOString()}`);

    logger.info('Performing dummy Supabase query to test DB connection path...');
    const { data, error } = await supabase.from('_healthcheck').select('*').limit(1);

    if (error && error.code !== 'PGRST116' && !error.message.includes('relation')) {
        logger.warn(`Supabase query returned notice: ${error.message}`);
    } else {
        logger.info('Supabase client connection path verified successfully.');
    }
    logger.info("reminders job finished");
});