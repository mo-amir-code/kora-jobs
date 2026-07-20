import { logger } from '../../lib/logger';
import { supabase } from '../../lib/supabase';
import { HelloWorldConfig } from './types';

export async function run(): Promise<void> {
  const config: HelloWorldConfig = {
    logMessage: 'Hello, world!',
  };

  try {
    logger.info(config.logMessage);
    logger.info(`Current job timestamp: ${new Date().toISOString()}`);

    logger.info('Performing dummy Supabase query to test DB connection path...');
    const { data, error } = await supabase.from('_healthcheck').select('*').limit(1);

    if (error && error.code !== 'PGRST116' && !error.message.includes('relation')) {
      logger.warn(`Supabase query returned notice: ${error.message}`);
    } else {
      logger.info('Supabase client connection path verified successfully.');
    }
  } catch (error) {
    logger.error('Error executing hello-world job', error);
    throw error;
  }
}
