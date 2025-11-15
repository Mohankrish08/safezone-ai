import { TestBed } from '@angular/core/testing';

import { PythonApiService } from './python-api.service';

describe('PythonApiService', () => {
  let service: PythonApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PythonApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
