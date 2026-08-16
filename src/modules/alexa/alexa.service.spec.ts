import { Test, TestingModule } from '@nestjs/testing';
import { AlexaService } from './alexa.service';

describe('AlexaService', () => {
  let service: AlexaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlexaService],
    }).compile();

    service = module.get<AlexaService>(AlexaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
